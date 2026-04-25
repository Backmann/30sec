import { Controller, Get } from '@nestjs/common';

/**
 * Public, lightweight health check for Docker healthcheck.
 * Does NOT require auth.
 */
@Controller('health')
export class PublicHealthController {
  @Get()
  ping() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
