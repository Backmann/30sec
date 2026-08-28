import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class VerificationCodesService implements OnModuleDestroy {
  private readonly logger = new Logger(VerificationCodesService.name);
  private readonly redis: Redis;
  private readonly TTL_SECONDS = 15 * 60; // 15 minutes
  /** How many wrong codes we accept before the code is burned. */
  private readonly MAX_ATTEMPTS = 5;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    this.redis = new Redis(redisUrl!, { maxRetriesPerRequest: null });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(email: string): string {
    return `verify:${email.toLowerCase()}`;
  }

  private attemptsKey(email: string): string {
    return `verify:attempts:${email.toLowerCase()}`;
  }

  async set(email: string, code: string): Promise<void> {
    // A freshly issued code starts with a clean attempt counter, otherwise a
    // previous failed run would keep the new code locked.
    await this.redis.set(this.key(email), code, 'EX', this.TTL_SECONDS);
    await this.redis.del(this.attemptsKey(email));
  }

  async get(email: string): Promise<string | null> {
    return this.redis.get(this.key(email));
  }

  async delete(email: string): Promise<void> {
    await this.redis.del(this.key(email));
    await this.redis.del(this.attemptsKey(email));
  }

  async getTTL(email: string): Promise<number> {
    return this.redis.ttl(this.key(email));
  }

  /** True when the address has burned through its allowance. */
  async isLockedOut(email: string): Promise<boolean> {
    const raw = await this.redis.get(this.attemptsKey(email));
    return raw !== null && parseInt(raw, 10) >= this.MAX_ATTEMPTS;
  }

  /**
   * Count one wrong code. Returns how many tries are left.
   * The counter expires with the code so a lockout is never permanent.
   */
  async registerFailedAttempt(email: string): Promise<number> {
    const k = this.attemptsKey(email);
    const count = await this.redis.incr(k);
    if (count === 1) {
      await this.redis.expire(k, this.TTL_SECONDS);
    }
    if (count >= this.MAX_ATTEMPTS) {
      // Burn the code itself — guessing further is pointless and a new code
      // must be requested.
      await this.redis.del(this.key(email));
      this.logger.warn(`Verification code burned after ${count} failed attempts`);
    }
    return Math.max(0, this.MAX_ATTEMPTS - count);
  }
}
