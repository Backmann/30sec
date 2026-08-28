import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Durable copy of the live game state.
 *
 * The state used to live only in a Map inside the Node process: restarting the
 * container mid-tournament lost the current question, its phase and its timers,
 * and the game simply froze. With autoheal restarting unhealthy containers,
 * that was a realistic way to break a live tournament.
 *
 * Redis holds the copy; the in-memory Map in GameGateway stays the read path so
 * the many synchronous getGameState() callers keep working unchanged. On boot
 * RealtimeService loads everything back before the app serves traffic.
 */
@Injectable()
export class GameStateStore implements OnModuleDestroy {
  private readonly logger = new Logger(GameStateStore.name);
  private readonly redis: Redis;
  private readonly PREFIX = 'game:state:';
  /** A question never outlives this; stale keys expire on their own. */
  private readonly TTL_SECONDS = 6 * 60 * 60;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL')!, {
      maxRetriesPerRequest: null,
    });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(tournamentId: string) {
    return `${this.PREFIX}${tournamentId}`;
  }

  /**
   * Write-through. Deliberately not awaited by callers: a Redis hiccup must
   * never stall the game loop, and the in-memory copy is still correct.
   */
  save(tournamentId: string, state: any): void {
    this.redis
      .set(this.key(tournamentId), JSON.stringify(state), 'EX', this.TTL_SECONDS)
      .catch((err) => this.logger.warn(`Could not persist game state: ${err.message}`));
  }

  remove(tournamentId: string): void {
    this.redis
      .del(this.key(tournamentId))
      .catch((err) => this.logger.warn(`Could not drop game state: ${err.message}`));
  }

  /** Every state still stored, keyed by tournament id. Used once, at boot. */
  async loadAll(): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor, 'MATCH', `${this.PREFIX}*`, 'COUNT', 100,
        );
        cursor = next;
        for (const key of keys) {
          const raw = await this.redis.get(key);
          if (!raw) continue;
          try {
            result.set(key.slice(this.PREFIX.length), JSON.parse(raw));
          } catch {
            this.logger.warn(`Skipping unreadable game state at ${key}`);
          }
        }
      } while (cursor !== '0');
    } catch (err) {
      // Losing the restore is bad but not fatal: the app still starts, and an
      // admin can restart the question manually.
      this.logger.error(`Could not read stored game states: ${err.message}`);
    }
    return result;
  }
}
