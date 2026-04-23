import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as UAParser from 'ua-parser-js';
import * as geoip from 'geoip-lite';

/**
 * Merges recent activity into a single session if it's within this window (minutes).
 * Beyond this — a new session is created.
 */
const SESSION_MERGE_WINDOW_MINUTES = 30;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called when a user is active. Either updates the current session
   * or starts a new one if >30 minutes passed.
   */
  async trackActivity(userId: string, req: any) {
    try {
      const ip = this.extractIp(req);
      const ua = req.headers['user-agent'] || '';

      // Parse UA
      const parser = new UAParser.UAParser(ua);
      const uaResult = parser.getResult();
      const deviceType = uaResult.device.type || (uaResult.os.name?.match(/Android|iOS/) ? 'mobile' : 'desktop');
      const osName = [uaResult.os.name, uaResult.os.version].filter(Boolean).join(' ') || null;
      const browserName = [uaResult.browser.name, uaResult.browser.version?.split('.')[0]].filter(Boolean).join(' ') || null;

      // Geo lookup from IP
      const geo = ip ? geoip.lookup(ip) : null;

      // Look for recent session (within merge window)
      const cutoff = new Date(Date.now() - SESSION_MERGE_WINDOW_MINUTES * 60 * 1000);
      const recent = await this.prisma.userSession.findFirst({
        where: {
          userId,
          lastSeenAt: { gte: cutoff },
          ipAddress: ip,
          userAgent: ua,
        },
        orderBy: { lastSeenAt: 'desc' },
      });

      const now = new Date();

      if (recent) {
        // Update existing session
        const newDuration = Math.round((now.getTime() - new Date(recent.startedAt).getTime()) / 1000);
        await this.prisma.userSession.update({
          where: { id: recent.id },
          data: {
            lastSeenAt: now,
            durationSeconds: newDuration,
          },
        });
      } else {
        // Start new session
        await this.prisma.userSession.create({
          data: {
            userId,
            ipAddress: ip,
            userAgent: ua,
            deviceType,
            osName,
            browserName,
            countryCode: geo?.country || null,
            countryName: geo?.country || null,  // geoip-lite returns only code; can enrich later
            city: geo?.city || null,
            region: geo?.region || null,
            latitude: geo?.ll?.[0] || null,
            longitude: geo?.ll?.[1] || null,
            timezone: geo?.timezone || null,
            startedAt: now,
            lastSeenAt: now,
            durationSeconds: 0,
          },
        });
      }
    } catch (err) {
      // Never let tracking break the request
      this.logger.warn(`Tracking failed for user ${userId}: ${err.message}`);
    }
  }

  /** Extract real client IP honoring Cloudflare and nginx proxy headers. */
  private extractIp(req: any): string | null {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return Array.isArray(cf) ? cf[0] : cf;
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const first = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim();
      return first || null;
    }
    const xri = req.headers['x-real-ip'];
    if (xri) return Array.isArray(xri) ? xri[0] : xri;
    return req.ip || req.connection?.remoteAddress || null;
  }
}
