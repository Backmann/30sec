import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RanksService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Get all ranks ────────────────────────────
  async findAll() {
    return this.prisma.rank.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Global leaderboard (top players) ─────────
  async globalLeaderboard(limit: number = 50) {
    const stats = await this.prisma.playerStat.findMany({
      where: {
        totalAnswered: { gt: 0 },
        user: { role: 'USER' },
      },
      orderBy: [
        { totalCorrect: 'desc' },
        { accuracyPercent: 'desc' },
        { bestStreak: 'desc' },
      ],
      take: limit,
      include: {
        user: {
          include: {
            profile: {
              select: {
                nickname: true,
                countryCode: true,
                flagCode: true,
              },
            },
          },
        },
        rank: {
          select: {
            code: true,
            title: true,
            icon: true,
          },
        },
      },
    });

    return stats.map((s, index) => ({
      position: index + 1,
      nickname: s.user.profile?.nickname || 'unknown',
      countryCode: s.user.profile?.countryCode || null,
      flagCode: s.user.profile?.flagCode || null,
      totalCorrect: s.totalCorrect,
      totalAnswered: s.totalAnswered,
      accuracyPercent: s.accuracyPercent,
      bestStreak: s.bestStreak,
      wins12_0: s.wins12_0,
      rank: s.rank,
    }));
  }

  // ─── Leaderboard by accuracy ──────────────────
  async accuracyLeaderboard(minAnswers: number = 10, limit: number = 50) {
    const stats = await this.prisma.playerStat.findMany({
      where: {
        totalAnswered: { gte: minAnswers },
        user: { role: 'USER' },
      },
      orderBy: [
        { accuracyPercent: 'desc' },
        { totalCorrect: 'desc' },
      ],
      take: limit,
      include: {
        user: {
          include: {
            profile: {
              select: { nickname: true, countryCode: true, flagCode: true },
            },
          },
        },
        rank: { select: { code: true, title: true, icon: true } },
      },
    });

    return stats.map((s, index) => ({
      position: index + 1,
      nickname: s.user.profile?.nickname || 'unknown',
      countryCode: s.user.profile?.countryCode || null,
      flagCode: s.user.profile?.flagCode || null,
      accuracyPercent: s.accuracyPercent,
      totalCorrect: s.totalCorrect,
      totalAnswered: s.totalAnswered,
      bestStreak: s.bestStreak,
      rank: s.rank,
    }));
  }
}
