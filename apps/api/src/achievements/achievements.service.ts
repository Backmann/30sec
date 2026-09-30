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
    // 'first_answer' was granted here on a streak of 1, which is a different
    // thing: a streak drops back to 1 after every miss. It is now granted
    // from the answer count, where it belongs.
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

  /**
   * Award everything a user has already earned.
   *
   * The event hooks only fire from now on, so without this anyone who had
   * already won five tournaments would wait for a sixth before seeing
   * "wins_5". Derives each achievement from stored data rather than from
   * counters, and relies on grant() being idempotent, so it is safe to run
   * repeatedly.
   *
   * Covers only what the data can prove. quick_draw needs an answer time
   * nothing records yet; spectator, weekly_streak and monthly_streak have no
   * source at all. Those stay locked until they are implemented.
   */
  async backfillForUser(userId: string): Promise<number> {
    let granted = 0;
    const award = async (code: string) => {
      if (await this.grant(userId, code)) granted++;
    };

    // Anyone with a stored session has logged in at least once.
    const sessions = await this.prisma.userSession.count({ where: { userId } });
    if (sessions > 0) await award('first_login');

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (profile && this.isProfileComplete(profile)) await award('profile_complete');

    const stats = await this.prisma.playerStat.findUnique({ where: { userId } });
    if (stats) {
      if (stats.totalAnswered >= 1) await award('first_answer');
      if (stats.bestStreak >= 3) await award('streak_3');
      if (stats.bestStreak >= 5) await award('streak_5');
      if (stats.bestStreak >= 10) await award('streak_10');
    }

    const participations = await this.prisma.tournamentParticipant.findMany({
      where: { userId },
      select: { tournamentId: true, matchStatus: true, currentScoreUser: true, currentScoreSystem: true },
    });
    const wins = participations.filter((p) => p.matchStatus === 'WON').length;
    if (wins >= 1) await award('first_win');
    if (wins >= 5) await award('wins_5');
    if (wins >= 10) await award('wins_10');
    if (wins >= 25) await award('wins_25');
    // 12:11 can only be reached from 11:11, so such a win was decided on the
    // final question.
    if (participations.some((p) => p.matchStatus === 'WON' && p.currentScoreUser === 12 && p.currentScoreSystem === 11)) {
      await award('decisive_winner');
    }

    // Accuracy achievements are per tournament, so each played match is
    // checked separately.
    for (const p of participations) {
      const judged = await this.prisma.judgement.findMany({
        where: { answer: { userId, tournamentId: p.tournamentId } },
        select: { decision: true },
      });
      const total = judged.length;
      if (total === 0) continue;
      const accepted = judged.filter((j) => j.decision === 'ACCEPTED').length;
      if (total >= 10 && accepted / total >= 0.8) await award('sharp_shooter');
      if (total >= 5 && accepted === total) await award('perfect_round');
    }

    const authored = await this.prisma.question.count({ where: { createdBy: userId } });
    if (authored >= 1) await award('creator_1');
    if (authored >= 10) await award('creator_10');

    const votes = await this.prisma.questionVote.count({ where: { voterUserId: userId } });
    if (votes >= 1) await award('first_vote');

    return granted;
  }

  /** Run the backfill for every user. Returns how many were granted in total. */
  async backfillAll(): Promise<{ users: number; granted: number }> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let granted = 0;
    for (const u of users) {
      granted += await this.backfillForUser(u.id);
    }
    this.logger.log(`Backfill: ${granted} achievement(s) across ${users.length} user(s)`);
    return { users: users.length, granted };
  }

  /** Avatar, bio and country — the three the description asks for. */
  isProfileComplete(profile: { avatarUrl?: string | null; bio?: string | null; countryCode?: string | null }): boolean {
    return Boolean(profile.avatarUrl?.trim() && profile.bio?.trim() && profile.countryCode?.trim());
  }
}
