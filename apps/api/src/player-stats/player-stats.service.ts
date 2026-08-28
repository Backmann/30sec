import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single source of truth for PlayerStat numbers.
 *
 * Stats are DERIVED, never accumulated by hand. Every counted answer has a
 * judgement — including the auto-rejections created when a player runs out of
 * time — so the whole row can be rebuilt from judgements at any moment.
 *
 * This exists because incremental counters drifted badly: deleting a tournament
 * removed its answers and judgements but left the counters untouched, so
 * players ended up with dozens of "answers" that no data supports.
 */
@Injectable()
export class PlayerStatsService {
  private readonly logger = new Logger(PlayerStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Rebuild one player's stats from the judgements that still exist. */
  async recalculate(userId: string) {
    const judgements = await this.prisma.judgement.findMany({
      where: { answer: { userId } },
      select: { decision: true, judgedAt: true },
      orderBy: { judgedAt: 'asc' },
    });

    const totalAnswered = judgements.length;
    const totalCorrect = judgements.filter(j => j.decision === 'ACCEPTED').length;
    const totalWrong = totalAnswered - totalCorrect;

    // One pass gives both the trailing run and the longest run.
    let currentStreak = 0;
    let bestStreak = 0;
    for (const j of judgements) {
      if (j.decision === 'ACCEPTED') {
        currentStreak += 1;
        if (currentStreak > bestStreak) bestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }

    const [wins12_0, losses0_12] = await Promise.all([
      this.prisma.tournamentParticipant.count({
        where: { userId, matchStatus: 'WON', currentScoreSystem: 0 },
      }),
      this.prisma.tournamentParticipant.count({
        where: { userId, matchStatus: 'LOST', currentScoreUser: 0 },
      }),
    ]);

    const accuracyPercent =
      totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 100 * 100) / 100
        : 0;

    await this.prisma.playerStat.updateMany({
      where: { userId },
      data: {
        totalAnswered,
        totalCorrect,
        totalWrong,
        currentStreak,
        bestStreak,
        accuracyPercent,
        wins12_0,
        losses0_12,
      },
    });

    await this.updateRank(userId);

    return { userId, totalAnswered, totalCorrect, totalWrong, currentStreak, bestStreak, accuracyPercent };
  }

  /** Recalculate several players, one after another (small numbers expected). */
  async recalculateMany(userIds: string[]) {
    const unique = Array.from(new Set(userIds));
    const results = [];
    for (const id of unique) {
      try {
        results.push(await this.recalculate(id));
      } catch (err) {
        this.logger.warn(`Recalculate failed for ${id}: ${err.message}`);
      }
    }
    return results;
  }

  /** Repair tool: rebuild every player's stats. Admin-triggered, not automatic. */
  async recalculateAll() {
    const stats = await this.prisma.playerStat.findMany({ select: { userId: true } });
    const results = await this.recalculateMany(stats.map(s => s.userId));
    this.logger.log(`Recalculated stats for ${results.length} players`);
    return { players: results.length, results };
  }

  /** Assign the highest rank the player's totalCorrect qualifies for. */
  async updateRank(userId: string) {
    try {
      const stats = await this.prisma.playerStat.findUnique({ where: { userId } });
      if (!stats) return;

      const ranks = await this.prisma.rank.findMany({
        orderBy: { thresholdCorrectAnswers: 'desc' },
      });

      let newRankId: string | null = null;
      for (const rank of ranks) {
        if (stats.totalCorrect >= rank.thresholdCorrectAnswers) {
          newRankId = rank.id;
          break;
        }
      }

      if (newRankId && stats.rankId !== newRankId) {
        await this.prisma.playerStat.update({
          where: { userId },
          data: { rankId: newRankId },
        });
      }
    } catch (err) {
      this.logger.warn(`Rank update failed for ${userId}: ${err.message}`);
    }
  }
}
