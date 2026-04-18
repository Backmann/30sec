import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class VerificationCodesService implements OnModuleDestroy {
  private readonly logger = new Logger(VerificationCodesService.name);
  private readonly redis: Redis;
  private readonly TTL_SECONDS = 15 * 60; // 15 minutes

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

  async set(email: string, code: string): Promise<void> {
    await this.redis.set(this.key(email), code, 'EX', this.TTL_SECONDS);
  }

  async get(email: string): Promise<string | null> {
    return this.redis.get(this.key(email));
  }

  async delete(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }

  async getTTL(email: string): Promise<number> {
    return this.redis.ttl(this.key(email));
  }
}
