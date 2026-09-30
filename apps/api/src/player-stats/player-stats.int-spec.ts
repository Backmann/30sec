import { prisma } from '../../test/setup-integration';
import { makeAdmin, makeJudgedAnswer, makePlayedMatch, makeQuestion, makeTournament, makeUser } from '../../test/factories';
import { PlayerStatsService } from './player-stats.service';

/**
 * Statistics are derived from judgements rather than accumulated, and this is
 * where that promise is kept or broken. The bug that prompted the rewrite —
 * deleting a tournament left counters behind, so players showed dozens of
 * answers no data supported — is the last test in this file.
 */
describe('PlayerStatsService (integration)', () => {
  const service = () => new PlayerStatsService(prisma as any);

  it('counts what the judgements say, not what a counter remembers', async () => {
    const admin = await makeAdmin(prisma);
    const player = await makeUser(prisma);

    await makePlayedMatch(prisma, {
      playerId: player.id,
      adminId: admin.id,
      outcomes: ['ACCEPTED', 'REJECTED', 'ACCEPTED', 'ACCEPTED'],
    });

    const result = await service().recalculate(player.id);

    expect(result.totalAnswered).toBe(4);
    expect(result.totalCorrect).toBe(3);
    expect(result.totalWrong).toBe(1);

    const stored = await prisma.playerStat.findUnique({ where: { userId: player.id } });
    expect(stored?.totalAnswered).toBe(4);
    expect(stored?.totalCorrect).toBe(3);
  });

  it('ignores whatever the stored counters claimed beforehand', async () => {
    const admin = await makeAdmin(prisma);
    const player = await makeUser(prisma);

    // The exact corruption that was found in production: counters inflated
    // with no judgements behind them.
    await prisma.playerStat.updateMany({
      where: { userId: player.id },
      data: { totalAnswered: 54, totalCorrect: 40, totalWrong: 14 },
    });

    await makePlayedMatch(prisma, { playerId: player.id, adminId: admin.id, outcomes: ['ACCEPTED'] });
    await service().recalculate(player.id);

    const stored = await prisma.playerStat.findUnique({ where: { userId: player.id } });
    expect(stored?.totalAnswered).toBe(1);
    expect(stored?.totalCorrect).toBe(1);
    expect(stored?.totalWrong).toBe(0);
  });

  it('zeroes a player whose judgements have all gone', async () => {
    const admin = await makeAdmin(prisma);
    const player = await makeUser(prisma);
    const tournament = await makePlayedMatch(prisma, {
      playerId: player.id,
      adminId: admin.id,
      outcomes: ['ACCEPTED', 'ACCEPTED'],
    });

    await service().recalculate(player.id);
    expect((await prisma.playerStat.findUnique({ where: { userId: player.id } }))?.totalAnswered).toBe(2);

    // Deleting a tournament cascades its answers and judgements away. This is
    // the case the counters used to survive.
    await prisma.tournament.delete({ where: { id: tournament.id } });
    await service().recalculate(player.id);

    const stored = await prisma.playerStat.findUnique({ where: { userId: player.id } });
    expect(stored?.totalAnswered).toBe(0);
    expect(stored?.totalCorrect).toBe(0);
    expect(stored?.accuracyPercent?.toString()).toBe('0');
  });

  describe('streaks', () => {
    it('reports the trailing run as the current streak', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'ACCEPTED', 'REJECTED', 'ACCEPTED', 'ACCEPTED'],
      });

      const result = await service().recalculate(player.id);
      expect(result.currentStreak).toBe(2);
    });

    it('remembers the longest run even after it is broken', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'REJECTED', 'ACCEPTED'],
      });

      const result = await service().recalculate(player.id);
      expect(result.bestStreak).toBe(3);
      expect(result.currentStreak).toBe(1);
    });

    it('drops the current streak to zero after a miss', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'ACCEPTED', 'REJECTED'],
      });

      const result = await service().recalculate(player.id);
      expect(result.currentStreak).toBe(0);
      expect(result.bestStreak).toBe(2);
    });

    it('counts streaks in judgement order, not insertion order', async () => {
      // Judgements are ordered by judgedAt, so a row written last but judged
      // first must still count first. Undo-and-rejudge produces exactly this.
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const base = Date.now();

      const later = await makeQuestion(prisma, admin.id);
      await makeJudgedAnswer(prisma, {
        userId: player.id, tournamentId: tournament.id, questionId: later.id,
        judgeId: admin.id, decision: 'REJECTED', judgedAt: new Date(base + 5000),
      });

      const earlier = await makeQuestion(prisma, admin.id);
      await makeJudgedAnswer(prisma, {
        userId: player.id, tournamentId: tournament.id, questionId: earlier.id,
        judgeId: admin.id, decision: 'ACCEPTED', judgedAt: new Date(base),
      });

      const result = await service().recalculate(player.id);
      // Accepted then rejected: best 1, current 0. The reverse order would
      // give current 1.
      expect(result.bestStreak).toBe(1);
      expect(result.currentStreak).toBe(0);
    });
  });

  describe('accuracy', () => {
    it('keeps two decimal places rather than rounding to a whole percent', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'REJECTED', 'REJECTED'],
      });

      const result = await service().recalculate(player.id);
      expect(result.accuracyPercent).toBe(33.33);
    });

    it('is zero, not an error, for a player who has never answered', async () => {
      const player = await makeUser(prisma);
      const result = await service().recalculate(player.id);
      expect(result.accuracyPercent).toBe(0);
      expect(result.totalAnswered).toBe(0);
    });
  });

  describe('ranks', () => {
    async function seedRanks() {
      const ladder = [
        { code: 'wooden', title: 'Деревянный', thresholdCorrectAnswers: 0, sortOrder: 1 },
        { code: 'bronze', title: 'Бронза', thresholdCorrectAnswers: 3, sortOrder: 2 },
        { code: 'silver', title: 'Серебро', thresholdCorrectAnswers: 6, sortOrder: 3 },
      ];
      for (const r of ladder) await prisma.rank.create({ data: r });
    }

    it('promotes on reaching a threshold', async () => {
      await seedRanks();
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'ACCEPTED', 'ACCEPTED'],
      });

      await service().recalculate(player.id);

      const stats = await prisma.playerStat.findUnique({
        where: { userId: player.id },
        include: { rank: true },
      });
      expect(stats?.rank?.code).toBe('bronze');
    });

    it('does not promote one answer short', async () => {
      await seedRanks();
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      await makePlayedMatch(prisma, {
        playerId: player.id,
        adminId: admin.id,
        outcomes: ['ACCEPTED', 'ACCEPTED'],
      });

      await service().recalculate(player.id);

      const stats = await prisma.playerStat.findUnique({
        where: { userId: player.id },
        include: { rank: true },
      });
      expect(stats?.rank?.code).toBe('wooden');
    });
  });

  it('recalculates several players without mixing them up', async () => {
    const admin = await makeAdmin(prisma);
    const a = await makeUser(prisma);
    const b = await makeUser(prisma);

    await makePlayedMatch(prisma, { playerId: a.id, adminId: admin.id, outcomes: ['ACCEPTED', 'ACCEPTED'] });
    await makePlayedMatch(prisma, { playerId: b.id, adminId: admin.id, outcomes: ['REJECTED'] });

    await service().recalculateMany([a.id, b.id]);

    const statsA = await prisma.playerStat.findUnique({ where: { userId: a.id } });
    const statsB = await prisma.playerStat.findUnique({ where: { userId: b.id } });
    expect(statsA?.totalCorrect).toBe(2);
    expect(statsB?.totalCorrect).toBe(0);
    expect(statsB?.totalWrong).toBe(1);
  });
});
