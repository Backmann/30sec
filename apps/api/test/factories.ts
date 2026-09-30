import { PrismaClient } from '@prisma/client';

/**
 * Builders for test data.
 *
 * A match needs a user, a profile, a tournament, a question with a
 * localisation, a participant row, an answer and a judgement before anything
 * can be asserted. Written out in every test, that setup buries the one line
 * that matters. These keep the noise in one place and let each test say only
 * what makes it different.
 *
 * Every builder takes overrides, so a test that cares about one field states
 * that field and nothing else.
 */

let seq = 0;
const unique = () => `${Date.now()}-${++seq}`;

export async function makeUser(
  prisma: PrismaClient,
  overrides: Record<string, any> = {},
) {
  const id = unique();
  const { nickname, ...userOverrides } = overrides;
  return prisma.user.create({
    data: {
      email: `user-${id}@example.invalid`,
      role: 'USER',
      profile: {
        create: {
          nickname: nickname ?? `player_${id}`,
          language: 'ru',
        },
      },
      playerStats: { create: {} },
      ...userOverrides,
    },
    include: { profile: true, playerStats: true },
  });
}

export async function makeAdmin(prisma: PrismaClient, overrides: Record<string, any> = {}) {
  return makeUser(prisma, { role: 'ADMIN', ...overrides });
}

export async function makeTournament(
  prisma: PrismaClient,
  createdBy: string,
  overrides: Record<string, any> = {},
) {
  return prisma.tournament.create({
    data: {
      title: `Tournament ${unique()}`,
      type: 'WEEKLY',
      status: 'LIVE',
      createdBy,
      ...overrides,
    },
  });
}

export async function makeQuestion(
  prisma: PrismaClient,
  createdBy: string,
  overrides: Record<string, any> = {},
) {
  const id = unique();
  return prisma.question.create({
    data: {
      category: 'LOGIC',
      status: 'ACTIVE',
      createdBy,
      localizations: {
        create: {
          language: 'ru',
          questionText: `Вопрос ${id}`,
          correctAnswerLocalized: `Ответ ${id}`,
        },
      },
      ...overrides,
    },
    include: { localizations: true },
  });
}

export async function makeParticipant(
  prisma: PrismaClient,
  userId: string,
  tournamentId: string,
  overrides: Record<string, any> = {},
) {
  return prisma.tournamentParticipant.create({
    data: { userId, tournamentId, matchStatus: 'PLAYING', ...overrides },
  });
}

/**
 * An answer with its ruling — the pair every statistic is derived from.
 * `judgedAt` is settable because streaks are computed in judgement order, and
 * rows created in one loop otherwise share a timestamp.
 */
export async function makeJudgedAnswer(
  prisma: PrismaClient,
  args: {
    userId: string;
    tournamentId: string;
    questionId: string;
    judgeId: string;
    decision: 'ACCEPTED' | 'REJECTED';
    judgedAt?: Date;
    answeredDuringReading?: boolean;
    answerText?: string;
  },
) {
  const answer = await prisma.answer.create({
    data: {
      userId: args.userId,
      tournamentId: args.tournamentId,
      questionId: args.questionId,
      answerText: args.answerText ?? 'ответ',
      answeredDuringReading: args.answeredDuringReading ?? false,
    },
  });
  const judgement = await prisma.judgement.create({
    data: {
      answerId: answer.id,
      judgeId: args.judgeId,
      decision: args.decision,
      judgedAt: args.judgedAt ?? new Date(),
    },
  });
  return { answer, judgement };
}

/**
 * A whole match in one call: a tournament, its questions, and one judged
 * answer per outcome in the order given.
 *
 * `outcomes` reads as the match did — ['ACCEPTED', 'REJECTED', 'ACCEPTED'] is
 * right, wrong, right — which makes streak expectations legible in the test.
 */
export async function makePlayedMatch(
  prisma: PrismaClient,
  args: {
    playerId: string;
    adminId: string;
    outcomes: Array<'ACCEPTED' | 'REJECTED'>;
    tournamentId?: string;
  },
) {
  const tournament = args.tournamentId
    ? await prisma.tournament.findUniqueOrThrow({ where: { id: args.tournamentId } })
    : await makeTournament(prisma, args.adminId);

  await prisma.tournamentParticipant.upsert({
    where: { userId_tournamentId: { userId: args.playerId, tournamentId: tournament.id } },
    update: {},
    create: { userId: args.playerId, tournamentId: tournament.id, matchStatus: 'PLAYING' },
  });

  const base = Date.now();
  for (let i = 0; i < args.outcomes.length; i++) {
    const question = await makeQuestion(prisma, args.adminId);
    await prisma.tournamentQuestion.create({
      data: { tournamentId: tournament.id, questionId: question.id, orderIndex: i, isUsed: true },
    });
    await makeJudgedAnswer(prisma, {
      userId: args.playerId,
      tournamentId: tournament.id,
      questionId: question.id,
      judgeId: args.adminId,
      decision: args.outcomes[i],
      // One second apart, so ordering by judgedAt is deterministic.
      judgedAt: new Date(base + i * 1000),
    });
  }

  return tournament;
}
