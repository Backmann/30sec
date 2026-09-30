import { prisma } from '../../test/setup-integration';
import { makeAdmin, makeJudgedAnswer, makeQuestion, makeTournament, makeUser } from '../../test/factories';

/**
 * What the database guarantees on its own.
 *
 * These rules are enforced by the schema rather than by application code, so
 * they hold even when a service forgets them — and they are invisible in
 * review, because nothing in the TypeScript says so. When someone later
 * changes an onDelete or drops an index, this is what will object.
 */
/**
 * Assert that a call failed for the reason the test is actually about.
 *
 * `rejects.toThrow()` passes on any error, which makes it a poor witness: a
 * missing required column rejects just as readily as a violated unique index,
 * and the test goes green either way. One of these tests was doing exactly
 * that before this helper existed.
 *
 * Prisma error codes: P2002 is a unique constraint, P2003 a foreign key,
 * P2014 a required-relation violation. Delete-restrict surfaces as one of the
 * latter two depending on which side Prisma checks first, so both are allowed
 * where a restriction is expected.
 */
async function expectRejection(
  promise: Promise<unknown>,
  allowedCodes: string[],
  what: string,
): Promise<void> {
  let error: any;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  if (!error) {
    throw new Error(`Expected ${what} to be rejected, but it succeeded.`);
  }
  if (!allowedCodes.includes(error.code)) {
    throw new Error(
      `Expected ${what} to fail with ${allowedCodes.join(' or ')}, ` +
        `but it failed with ${error.code ?? '(no code)'}: ${error.message?.split('\n')[0]}`,
    );
  }
}

const UNIQUE = ['P2002'];
const RESTRICTED = ['P2003', 'P2014'];

describe('schema guarantees (integration)', () => {
  describe('deleting a user', () => {
    it('takes their profile, sessions and notifications with them', async () => {
      const user = await makeUser(prisma);
      await prisma.userSession.create({
        data: { userId: user.id, ipAddress: '203.0.113.1' },
      });
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: 'TOURNAMENT',
          title: 'Hi',
          body: 'There',
          channel: 'IN_APP',
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.playerStat.count({ where: { userId: user.id } })).toBe(0);
    });

    it('is refused while they are the author of a question', async () => {
      const admin = await makeAdmin(prisma);
      await makeQuestion(prisma, admin.id);

      // Restrict, not Cascade: deleting the author would silently take the
      // question library with them.
      await expectRejection(
        prisma.user.delete({ where: { id: admin.id } }),
        RESTRICTED,
        'deleting the author of a question',
      );
    });

    it('is refused while they are the creator of a tournament', async () => {
      const admin = await makeAdmin(prisma);
      await makeTournament(prisma, admin.id);

      await expectRejection(
        prisma.user.delete({ where: { id: admin.id } }),
        RESTRICTED,
        'deleting the creator of a tournament',
      );
    });

    it('is refused while they have judged an answer', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);
      await makeJudgedAnswer(prisma, {
        userId: player.id, tournamentId: tournament.id, questionId: question.id,
        judgeId: admin.id, decision: 'ACCEPTED',
      });

      // The judge is restricted too — a match history without its rulings
      // would be unreadable.
      await expectRejection(
        prisma.user.delete({ where: { id: admin.id } }),
        RESTRICTED,
        'deleting a judge',
      );
    });
  });

  describe('deleting a tournament', () => {
    it('removes its answers, judgements and participants', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);
      await prisma.tournamentParticipant.create({
        data: { userId: player.id, tournamentId: tournament.id },
      });
      await prisma.tournamentQuestion.create({
        data: { tournamentId: tournament.id, questionId: question.id, orderIndex: 0 },
      });
      const { answer } = await makeJudgedAnswer(prisma, {
        userId: player.id, tournamentId: tournament.id, questionId: question.id,
        judgeId: admin.id, decision: 'ACCEPTED',
      });

      await prisma.tournament.delete({ where: { id: tournament.id } });

      expect(await prisma.answer.count({ where: { id: answer.id } })).toBe(0);
      expect(await prisma.judgement.count({ where: { answerId: answer.id } })).toBe(0);
      expect(await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } })).toBe(0);
      expect(await prisma.tournamentQuestion.count({ where: { tournamentId: tournament.id } })).toBe(0);
    });

    it('leaves the questions themselves in the library', async () => {
      const admin = await makeAdmin(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);
      await prisma.tournamentQuestion.create({
        data: { tournamentId: tournament.id, questionId: question.id, orderIndex: 0 },
      });

      await prisma.tournament.delete({ where: { id: tournament.id } });

      // Only the link is removed. Questions outlive the tournaments that used
      // them — that is the whole point of a library.
      expect(await prisma.question.count({ where: { id: question.id } })).toBe(1);
    });
  });

  describe('uniqueness', () => {
    it('allows one answer per player per question', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);

      await prisma.answer.create({
        data: { userId: player.id, tournamentId: tournament.id, questionId: question.id, answerText: 'first' },
      });

      // The service checks this too, but a race between two requests would
      // slip past that check and not past this one.
      await expectRejection(
        prisma.answer.create({
          data: { userId: player.id, tournamentId: tournament.id, questionId: question.id, answerText: 'second' },
        }),
        UNIQUE,
        'a second answer to the same question',
      );
    });

    it('allows one vote per player per tournament', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const q1 = await makeQuestion(prisma, admin.id);
      const q2 = await makeQuestion(prisma, admin.id);

      await prisma.questionVote.create({
        data: { tournamentId: tournament.id, questionId: q1.id, voterUserId: player.id },
      });

      await expectRejection(
        prisma.questionVote.create({
          data: { tournamentId: tournament.id, questionId: q2.id, voterUserId: player.id },
        }),
        UNIQUE,
        'a second vote in the same tournament',
      );
    });

    it('allows one judgement per answer', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);
      const { answer } = await makeJudgedAnswer(prisma, {
        userId: player.id, tournamentId: tournament.id, questionId: question.id,
        judgeId: admin.id, decision: 'ACCEPTED',
      });

      // Two rulings on one answer would double-count it in every statistic.
      await expectRejection(
        prisma.judgement.create({
          data: {
            answerId: answer.id,
            judgeId: admin.id,
            decision: 'REJECTED',
            judgedAt: new Date(),
          },
        }),
        UNIQUE,
        'a second ruling on the same answer',
      );
    });

    it('allows one position per question in a tournament', async () => {
      const admin = await makeAdmin(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const q1 = await makeQuestion(prisma, admin.id);
      const q2 = await makeQuestion(prisma, admin.id);

      await prisma.tournamentQuestion.create({
        data: { tournamentId: tournament.id, questionId: q1.id, orderIndex: 0 },
      });

      // This is why reordering shifts through an offset instead of swapping
      // in place: a direct swap violates this mid-update.
      await expectRejection(
        prisma.tournamentQuestion.create({
          data: { tournamentId: tournament.id, questionId: q2.id, orderIndex: 0 },
        }),
        UNIQUE,
        'a second question at the same position',
      );
    });

    it('allows one localisation per language per question', async () => {
      const admin = await makeAdmin(prisma);
      const question = await makeQuestion(prisma, admin.id);

      await expectRejection(
        prisma.questionLocalization.create({
          data: {
            questionId: question.id,
            language: 'ru',
            questionText: 'дубль',
            correctAnswerLocalized: 'дубль',
          },
        }),
        UNIQUE,
        'a second localisation in the same language',
      );
    });

    it('allows one participation per player per tournament', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);

      await prisma.tournamentParticipant.create({
        data: { userId: player.id, tournamentId: tournament.id },
      });

      await expectRejection(
        prisma.tournamentParticipant.create({
          data: { userId: player.id, tournamentId: tournament.id },
        }),
        UNIQUE,
        'a second participation in the same tournament',
      );
    });
  });

  describe('defaults', () => {
    it('starts a participant at nil-nil', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);

      const p = await prisma.tournamentParticipant.create({
        data: { userId: player.id, tournamentId: tournament.id },
      });

      expect(p.currentScoreUser).toBe(0);
      expect(p.currentScoreSystem).toBe(0);
      // The default match status is deliberately not asserted here. This
      // database is built from schema.prisma, which says PENDING, while
      // production says REGISTERED — the two drifted apart when the schema was
      // changed with raw SQL. Asserting either value would make this test
      // agree with one of them and quietly disagree with the other. The code
      // never relies on the default: join() sets the status explicitly.
    });

    it('starts an answer as not-early, so no past answer can claim the badge', async () => {
      const admin = await makeAdmin(prisma);
      const player = await makeUser(prisma);
      const tournament = await makeTournament(prisma, admin.id);
      const question = await makeQuestion(prisma, admin.id);

      const answer = await prisma.answer.create({
        data: { userId: player.id, tournamentId: tournament.id, questionId: question.id, answerText: 'x' },
      });

      expect(answer.answeredDuringReading).toBe(false);
    });

    it('starts a user active, unverified and at token version zero', async () => {
      const user = await makeUser(prisma);
      expect(user.isActive).toBe(true);
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.tokenVersion).toBe(0);
    });
  });
});
