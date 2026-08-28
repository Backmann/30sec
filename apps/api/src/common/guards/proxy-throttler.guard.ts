import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit tracker that survives the Cloudflare → nginx → API chain.
 *
 * The default ThrottlerGuard keys on `req.ip`, which — without Express's
 * `trust proxy` — is the nginx container address for EVERY request. That made
 * every limit global instead of per-client: five bad logins from one person
 * locked out the whole site, and the 60 req/min budget was shared by everyone.
 *
 * We deliberately do NOT read `X-Forwarded-For` or `CF-Connecting-IP`:
 *  - nginx APPENDS to X-Forwarded-For, so a client can prepend a fake address
 *    and rotate it to escape the limit entirely.
 *  - CF-Connecting-IP can be forged by connecting to the origin directly,
 *    bypassing Cloudflare.
 *
 * `X-Real-IP` is set by nginx itself from $remote_addr, and $remote_addr is
 * only rewritten by the real_ip module when the connection actually comes from
 * a Cloudflare range. So it is the one value a client cannot influence.
 */
@Injectable()
export class ProxyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const realIp = req.headers?.['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : String(realIp);
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }
}
