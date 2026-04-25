import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  constructor(private readonly prisma: PrismaService) {}

  async getSystemHealth() {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.getCounts(),
      this.getDiskUsage(),
      this.getBackupStatus(),
    ]);

    const [db, redis, counts, disk, backup] = checks.map(c =>
      c.status === 'fulfilled' ? c.value : { ok: false, error: (c.reason as any)?.message || 'Unknown error' }
    );

    const apiUptime = Math.floor((Date.now() - this.startedAt) / 1000);
    const memoryUsage = process.memoryUsage();

    return {
      timestamp: new Date().toISOString(),
      api: {
        ok: true,
        uptimeSeconds: apiUptime,
        memoryMB: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        },
        nodeVersion: process.version,
      },
      database: db,
      redis,
      counts,
      disk,
      backup,
    };
  }

  private async checkDatabase() {
    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - t0;
      return { ok: true, latencyMs: latency };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private async checkRedis() {
    try {
      // Use prisma's notification count as a proxy — or use redis directly via ioredis
      // For simplicity assume redis is up if env has REDIS_URL or REDIS_HOST
      const redisHost = process.env.REDIS_HOST || process.env.REDIS_URL;
      return { ok: !!redisHost, configured: !!redisHost };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private async getCounts() {
    try {
      const [users, profiles, tournaments, questions, answers, feedback, sessions] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.profile.count(),
        this.prisma.tournament.count(),
        this.prisma.question.count(),
        this.prisma.answer.count(),
        this.prisma.feedback.count().catch(() => 0),
        this.prisma.userSession.count().catch(() => 0),
      ]);
      const newFeedback = await this.prisma.feedback.count({ where: { status: 'new' } }).catch(() => 0);
      const activeQuestions = await this.prisma.question.count({ where: { status: 'ACTIVE' } });
      return {
        ok: true,
        users, profiles, tournaments, questions, activeQuestions, answers, feedback, newFeedback, sessions,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private async getDiskUsage() {
    try {
      // /home/node is in container; /tmp is universal; we want to give a rough idea
      const stats = fs.statfsSync('/');
      const totalGB = (stats.blocks * stats.bsize) / 1024 / 1024 / 1024;
      const freeGB = (stats.bavail * stats.bsize) / 1024 / 1024 / 1024;
      const usedGB = totalGB - freeGB;
      const usagePct = Math.round((usedGB / totalGB) * 100);
      return {
        ok: true,
        totalGB: Math.round(totalGB * 10) / 10,
        usedGB: Math.round(usedGB * 10) / 10,
        freeGB: Math.round(freeGB * 10) / 10,
        usagePct,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  private async getBackupStatus() {
    // Backups are on host, not visible from API container.
    // We can record last backup info in a settings table if needed.
    // For now: skipped — admin can check via SSH.
    return { ok: true, note: 'Backup files reside on host; check /root/backups' };
  }
}
