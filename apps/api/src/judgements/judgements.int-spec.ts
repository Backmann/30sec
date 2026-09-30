import { prisma } from '../../test/setup-integration';
import { makeAdmin, makeQuestion, makeTournament, makeUser } from '../../test/factories';
import { JudgementsService } from './judgements.service';
import { PlayerStatsService } from '../player-stats/player-stats.service';
import { AchievementsService } from '../achievements/achievements.service';

/**
 * Judging is where a match is actually decided: the ruling, the score, the
 * match status and the statistics all move together here. A mistake in this
 * file does not crash anything — it tells a player they lost.
 *
 * Realtime and the queue are stubbed because they broadcast; everything that
 * touches data is real, including achievements, so the interaction between
 * scoring and granting is covered rather than assumed.
 */
describe('JudgementsService (integration)', () => {
  const realtime = {
    judgementReady: jest.fn(),
    adminOnlyJudgement: jest.fn(),
  };
  const notifications = { create: jest.fn() };
  const queue = { addEmail: jest.fn(), scheduleTournamentReminder: jest.fn() };

  function service() {
    const achievements = new AchievementsService(prisma as any);
    const playerStats = new PlayerStatsService(prisma as any);
    return new JudgementsService(
      prisma as any,
      realtime as any,
      notifications as any,
      queue as any,
      achievements,
      playerStats,
    );
  }

  async function setUpMatch() {
    const admin = await makeAdmin(prisma);
    const player = await makeUser(prisma);
    const tournament = await makeTournament(prisma, admin.id);
    await prisma.tournamentParticipant.create({
      data: { userId: player.id, tournamentId: tournament.id, matchStatus: 'PLAYING' },
    });
    return { admin, player, tournament };
  }

  async function submitAnswer(
    playerId: string,
    tournamentId: string,
    adminId: string,
    opts: { answeredDuringReading?: boolean } = {},
  ) {
    const question = await makeQuestion(prisma, adminId);
    return prisma.answer.create({
      data: {
        userId: playerId,
        tournamentId,
        questionId: question.id,
        answerText: 'ответ',
        answeredDuringReading: opts.answeredDuringReading ?? false,
      },
    });
  }

  beforeEach(() => {
    realtime.judgementReady.mockClear();
    realtime.adminOnlyJudgement.mockClear();
  });

  it('gives the point to the player when the answer is accepted', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const answer = await submitAnswer(player.id, tournament.id, admin.id);

    const result = await service().judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);

    expect(result.score.user).toBe(1);
    expect(result.score.system).toBe(0);

    const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { userId_tournamentId: { userId: player.id, tournamentId: tournament.id } },
    });
    expect(participant.currentScoreUser).toBe(1);
    expect(participant.matchStatus).toBe('PLAYING');
  });

  it('gives the point to the system when it is rejected', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const answer = await submitAnswer(player.id, tournament.id, admin.id);

    const result = await service().judge({ answerId: answer.id, decision: 'REJECTED' } as any, admin.id);

    expect(result.score.user).toBe(0);
    expect(result.score.system).toBe(1);
  });

  it('refuses to rule on the same answer twice', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const answer = await submitAnswer(player.id, tournament.id, admin.id);
    const svc = service();

    await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);

    // A second ruling would double-count the answer everywhere.
    await expect(
      svc.judge({ answerId: answer.id, decision: 'REJECTED' } as any, admin.id),
    ).rejects.toThrow();

    expect(await prisma.judgement.count({ where: { answerId: answer.id } })).toBe(1);
  });

  it('ends the match when the player reaches twelve', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const svc = service();

    for (let i = 0; i < 12; i++) {
      const answer = await submitAnswer(player.id, tournament.id, admin.id);
      await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);
    }

    const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { userId_tournamentId: { userId: player.id, tournamentId: tournament.id } },
    });
    expect(participant.currentScoreUser).toBe(12);
    expect(participant.matchStatus).toBe('WON');
    expect(participant.finishedAt).not.toBeNull();
  });

  it('ends the match when the system reaches twelve', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const svc = service();

    for (let i = 0; i < 12; i++) {
      const answer = await submitAnswer(player.id, tournament.id, admin.id);
      await svc.judge({ answerId: answer.id, decision: 'REJECTED' } as any, admin.id);
    }

    const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { userId_tournamentId: { userId: player.id, tournamentId: tournament.id } },
    });
    expect(participant.matchStatus).toBe('LOST');
  });

  it('keeps statistics in step with the rulings as they are made', async () => {
    const { admin, player, tournament } = await setUpMatch();
    const svc = service();

    for (const decision of ['ACCEPTED', 'ACCEPTED', 'REJECTED'] as const) {
      const answer = await submitAnswer(player.id, tournament.id, admin.id);
      await svc.judge({ answerId: answer.id, decision } as any, admin.id);
    }

    const stats = await prisma.playerStat.findUniqueOrThrow({ where: { userId: player.id } });
    expect(stats.totalAnswered).toBe(3);
    expect(stats.totalCorrect).toBe(2);
    expect(stats.totalWrong).toBe(1);
    expect(stats.bestStreak).toBe(2);
    expect(stats.currentStreak).toBe(0);
  });

  describe('undo', () => {
    it('takes the point back and reopens the match', async () => {
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();
      const answer = await submitAnswer(player.id, tournament.id, admin.id);
      const { judgement } = await svc.judge(
        { answerId: answer.id, decision: 'ACCEPTED' } as any,
        admin.id,
      );

      await svc.undoJudgement(judgement.id);

      const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
        where: { userId_tournamentId: { userId: player.id, tournamentId: tournament.id } },
      });
      expect(participant.currentScoreUser).toBe(0);
      expect(await prisma.judgement.count({ where: { id: judgement.id } })).toBe(0);
    });

    it('reopens a finished match rather than leaving it won', async () => {
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      let lastJudgementId = '';
      for (let i = 0; i < 12; i++) {
        const answer = await submitAnswer(player.id, tournament.id, admin.id);
        const res = await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);
        lastJudgementId = res.judgement.id;
      }

      await svc.undoJudgement(lastJudgementId);

      const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
        where: { userId_tournamentId: { userId: player.id, tournamentId: tournament.id } },
      });
      // 11:0 is not a win, so the status has to come back down. Leaving it WON
      // is what an undo that only adjusts the score would do.
      expect(participant.currentScoreUser).toBe(11);
      expect(participant.matchStatus).toBe('PLAYING');
    });

    it('rebuilds statistics from what survives, not by subtracting', async () => {
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      const first = await submitAnswer(player.id, tournament.id, admin.id);
      await svc.judge({ answerId: first.id, decision: 'ACCEPTED' } as any, admin.id);
      const second = await submitAnswer(player.id, tournament.id, admin.id);
      const res = await svc.judge({ answerId: second.id, decision: 'ACCEPTED' } as any, admin.id);

      await svc.undoJudgement(res.judgement.id);

      const stats = await prisma.playerStat.findUniqueOrThrow({ where: { userId: player.id } });
      expect(stats.totalAnswered).toBe(1);
      expect(stats.totalCorrect).toBe(1);
      expect(stats.currentStreak).toBe(1);
    });
  });

  describe('achievements', () => {
    async function seedAchievements() {
      const list = [
        { code: 'first_win', title: 'Первая победа', description: '', icon: '🏆', category: 'wins', sortOrder: 10 },
        { code: 'streak_3', title: 'В ударе', description: '', icon: '🔥', category: 'streaks', sortOrder: 40 },
        { code: 'quick_draw', title: 'Быстрая рука', description: '', icon: '⚡', category: 'speed', sortOrder: 30 },
        { code: 'first_answer', title: 'Проба пера', description: '', icon: '✍️', category: 'onboarding', sortOrder: 2 },
      ];
      for (const a of list) await prisma.achievement.create({ data: a });
    }

    it('grants the first-answer badge on the very first answer', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const answer = await submitAnswer(player.id, tournament.id, admin.id);

      await service().judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);

      const unlocked = await prisma.userAchievement.findMany({
        where: { userId: player.id },
        include: { achievement: true },
      });
      expect(unlocked.map((u) => u.achievement.code)).toContain('first_answer');
    });

    it('grants a streak badge once the run is long enough', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      for (let i = 0; i < 3; i++) {
        const answer = await submitAnswer(player.id, tournament.id, admin.id);
        await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);
      }

      const unlocked = await prisma.userAchievement.findMany({
        where: { userId: player.id },
        include: { achievement: true },
      });
      expect(unlocked.map((u) => u.achievement.code)).toContain('streak_3');
    });

    it('grants the early-answer badge only when the answer was early and right', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      const late = await submitAnswer(player.id, tournament.id, admin.id, { answeredDuringReading: false });
      await svc.judge({ answerId: late.id, decision: 'ACCEPTED' } as any, admin.id);

      let codes = (
        await prisma.userAchievement.findMany({ where: { userId: player.id }, include: { achievement: true } })
      ).map((u) => u.achievement.code);
      expect(codes).not.toContain('quick_draw');

      const early = await submitAnswer(player.id, tournament.id, admin.id, { answeredDuringReading: true });
      await svc.judge({ answerId: early.id, decision: 'ACCEPTED' } as any, admin.id);

      codes = (
        await prisma.userAchievement.findMany({ where: { userId: player.id }, include: { achievement: true } })
      ).map((u) => u.achievement.code);
      expect(codes).toContain('quick_draw');
    });

    it('does not grant the early-answer badge for an early but wrong answer', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const early = await submitAnswer(player.id, tournament.id, admin.id, { answeredDuringReading: true });

      await service().judge({ answerId: early.id, decision: 'REJECTED' } as any, admin.id);

      const codes = (
        await prisma.userAchievement.findMany({ where: { userId: player.id }, include: { achievement: true } })
      ).map((u) => u.achievement.code);
      expect(codes).not.toContain('quick_draw');
    });

    it('grants the win badge when the match is won', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      for (let i = 0; i < 12; i++) {
        const answer = await submitAnswer(player.id, tournament.id, admin.id);
        await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);
      }

      const codes = (
        await prisma.userAchievement.findMany({ where: { userId: player.id }, include: { achievement: true } })
      ).map((u) => u.achievement.code);
      expect(codes).toContain('first_win');
    });

    it('never grants the same badge twice', async () => {
      await seedAchievements();
      const { admin, player, tournament } = await setUpMatch();
      const svc = service();

      for (let i = 0; i < 5; i++) {
        const answer = await submitAnswer(player.id, tournament.id, admin.id);
        await svc.judge({ answerId: answer.id, decision: 'ACCEPTED' } as any, admin.id);
      }

      const firstAnswerBadges = await prisma.userAchievement.count({
        where: { userId: player.id, achievement: { code: 'first_answer' } },
      });
      expect(firstAnswerBadges).toBe(1);
    });
  });
});
