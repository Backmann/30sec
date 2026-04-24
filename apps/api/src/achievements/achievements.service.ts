import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grant an achievement if the user doesn't have it yet.
   * Silent if already unlocked. Never throws — safe for event hooks.
   */
  async grant(userId: string, code: string): Promise<boolean> {
    try {
      const ach = await this.prisma.achievement.findUnique({ where: { code } });
      if (!ach) return false;
      const already = await this.prisma.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: ach.id } },
      });
      if (already) return false;
      await this.prisma.userAchievement.create({
        data: { userId, achievementId: ach.id },
      });
      // Fire a notification
      try {
        await this.prisma.notification.create({
          data: {
            userId,
            type: 'achievement',
            title: `${ach.icon} Новое достижение!`,
            body: `Вы получили «${ach.title}»: ${ach.description}`,
            channel: 'IN_APP',
          },
        });
      } catch {}
      this.logger.log(`Granted "${code}" to user ${userId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to grant ${code}: ${err.message}`);
      return false;
    }
  }

  /** Get all achievements with user's unlock status */
  async listForUser(userId: string) {
    const all = await this.prisma.achievement.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    const mine = await this.prisma.userAchievement.findMany({
      where: { userId },
      select: { achievementId: true, unlockedAt: true },
    });
    const mineMap = new Map(mine.map(m => [m.achievementId, m.unlockedAt]));
    return all.map(a => ({
      id: a.id,
      code: a.code,
      title: a.title,
      description: a.description,
      icon: a.icon,
      category: a.category,
      unlockedAt: mineMap.get(a.id) || null,
    }));
  }

  /** Public — only unlocked achievements for public profile */
  async listUnlockedByNickname(nickname: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { nickname },
      select: { userId: true },
    });
    if (!profile) return [];
    const unlocked = await this.prisma.userAchievement.findMany({
      where: { userId: profile.userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });
    return unlocked.map(u => ({
      code: u.achievement.code,
      title: u.achievement.title,
      description: u.achievement.description,
      icon: u.achievement.icon,
      category: u.achievement.category,
      unlockedAt: u.unlockedAt,
    }));
  }

  /** Check and grant win-related achievements after a tournament win */
  async onTournamentWon(userId: string, wasDecisive: boolean) {
    const winCount = await this.prisma.tournamentParticipant.count({
      where: { userId, matchStatus: 'WON' },
    });
    if (winCount >= 1) await this.grant(userId, 'first_win');
    if (winCount >= 5) await this.grant(userId, 'wins_5');
    if (winCount >= 10) await this.grant(userId, 'wins_10');
    if (winCount >= 25) await this.grant(userId, 'wins_25');
    if (wasDecisive) await this.grant(userId, 'decisive_winner');
  }

  /** Check streak-based achievements */
  async onAnswerAccepted(userId: string, currentStreak: number, answerTimeSeconds?: number) {
    if (currentStreak === 1) await this.grant(userId, 'first_answer');
    if (currentStreak >= 3) await this.grant(userId, 'streak_3');
    if (currentStreak >= 5) await this.grant(userId, 'streak_5');
    if (currentStreak >= 10) await this.grant(userId, 'streak_10');
    if (answerTimeSeconds !== undefined && answerTimeSeconds <= 5) {
      await this.grant(userId, 'quick_draw');
    }
  }

  /** After tournament finish — check accuracy achievements */
  async onTournamentFinished(userId: string, accepted: number, total: number) {
    if (total >= 10 && accepted / total >= 0.8) await this.grant(userId, 'sharp_shooter');
    if (total >= 5 && accepted === total) await this.grant(userId, 'perfect_round');
  }

  /** Creator-related */
  async onQuestionCreated(creatorId: string) {
    const count = await this.prisma.question.count({ where: { createdBy: creatorId } });
    if (count >= 1) await this.grant(creatorId, 'creator_1');
    if (count >= 10) await this.grant(creatorId, 'creator_10');
  }

  /** When user's question wins voting */
  async onBestQuestion(creatorId: string) {
    await this.grant(creatorId, 'best_question');
  }

  /** When user casts their first vote */
  async onFirstVote(userId: string) {
    await this.grant(userId, 'first_vote');
  }
}
