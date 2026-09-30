/**
 * The rules of a match, as pure functions.
 *
 * These decide who won, when a match is over, which phase a question is in and
 * how accuracy and ranks are derived. They were previously inlined across
 * judgements.service, realtime.service and tournaments.service — the win
 * condition existed in three copies and the thresholds in five, which is how
 * two of them came to disagree about whether a tie ends the match.
 *
 * Nothing here touches the database, the clock or the network: every input is
 * a parameter. That is deliberate — it is what makes these rules testable, and
 * the rules are the part of this system where a silent mistake costs the most.
 * A wrong score is not a crash; it is a player told they lost.
 */

/**
 * Points that win a match, and questions in a pool.
 *
 * deriveMatchStatus takes them as optional arguments defaulting to these, so
 * the draw branch can be exercised by tests: with an odd pool a draw is
 * arithmetically impossible, and an untestable branch is one that quietly
 * rots.
 */
const DEFAULT_MAX_SCORE = 12;
const DEFAULT_POOL_SIZE = 23;

export const MAX_SCORE = DEFAULT_MAX_SCORE;
export const QUESTIONS_PER_TOURNAMENT = DEFAULT_POOL_SIZE;

/** How long a question is shown before answers open, in milliseconds. */
export const READING_MS = 20_000;

/** How long answering stays open after reading ends, in milliseconds. */
export const ANSWERING_MS = 30_000;

export type MatchOutcome = 'PLAYING' | 'WON' | 'LOST' | 'FINISHED';
export type QuestionPhase = 'idle' | 'reading' | 'answering' | 'judging';
export type JudgementDecision = 'ACCEPTED' | 'REJECTED';

/**
 * The outcome implied by a score.
 *
 * First to MAX_SCORE takes it. Failing that, once every question has been
 * used the higher score wins and an exact tie is a draw — FINISHED rather
 * than WON or LOST.
 */
export function deriveMatchStatus(
  scoreUser: number,
  scoreSystem: number,
  opts: { maxScore?: number; poolSize?: number } = {},
): MatchOutcome {
  const MAX_SCORE = opts.maxScore ?? DEFAULT_MAX_SCORE;
  const QUESTIONS_PER_TOURNAMENT = opts.poolSize ?? DEFAULT_POOL_SIZE;

  if (scoreUser >= MAX_SCORE) return 'WON';
  if (scoreSystem >= MAX_SCORE) return 'LOST';
  if (scoreUser + scoreSystem >= QUESTIONS_PER_TOURNAMENT) {
    if (scoreUser > scoreSystem) return 'WON';
    if (scoreUser < scoreSystem) return 'LOST';
    return 'FINISHED';
  }
  return 'PLAYING';
}

/** Whether an outcome means the match is done. */
export function isMatchOver(status: string): boolean {
  return status === 'WON' || status === 'LOST' || status === 'FINISHED';
}

/**
 * Whether a win came down to the final question.
 *
 * 12:11 can only be reached from 11:11, so that score — and only that score —
 * means everything rode on the last answer.
 */
export function wasDecisiveWin(scoreUser: number, scoreSystem: number): boolean {
  return scoreUser === MAX_SCORE && scoreSystem === MAX_SCORE - 1;
}

/**
 * The score after a ruling. Every question awards exactly one point: to the
 * player when the answer is accepted, to the system when it is not. There is
 * no such thing as a drawn question.
 */
export function applyJudgement(
  scoreUser: number,
  scoreSystem: number,
  decision: JudgementDecision,
): { scoreUser: number; scoreSystem: number } {
  return decision === 'ACCEPTED'
    ? { scoreUser: scoreUser + 1, scoreSystem }
    : { scoreUser, scoreSystem: scoreSystem + 1 };
}

/**
 * Which phase a question is in, and how many seconds remain.
 *
 * Derived from absolute deadlines rather than counted down, which is what lets
 * a client join mid-phase, and what lets the server recover a running question
 * after a restart.
 */
export function derivePhase(
  now: number,
  state: { readingEndsAt?: number; answeringEndsAt?: number } | null | undefined,
): { phase: QuestionPhase; timerSeconds: number } {
  if (!state || typeof state.readingEndsAt !== 'number' || typeof state.answeringEndsAt !== 'number') {
    return { phase: 'idle', timerSeconds: 0 };
  }
  if (now < state.readingEndsAt) {
    return { phase: 'reading', timerSeconds: Math.ceil((state.readingEndsAt - now) / 1000) };
  }
  if (now < state.answeringEndsAt) {
    return { phase: 'answering', timerSeconds: Math.ceil((state.answeringEndsAt - now) / 1000) };
  }
  return { phase: 'judging', timerSeconds: 0 };
}

/**
 * Whether an answer arrived early enough to count as answering before the
 * clock started — the condition behind the "Быстрая рука" achievement.
 */
export function answeredDuringReading(
  submittedAt: number,
  state: { questionId?: string; readingEndsAt?: number } | null | undefined,
  questionId: string,
): boolean {
  if (!state || state.questionId !== questionId) return false;
  if (typeof state.readingEndsAt !== 'number') return false;
  return submittedAt < state.readingEndsAt;
}

/** Accuracy as a percentage, to two decimal places. Zero answers is zero. */
export function accuracyPercent(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100 * 100) / 100;
}

/**
 * The highest rank whose threshold the player has reached.
 *
 * Ranks may arrive in any order; this sorts them rather than trusting the
 * caller, because reading them back in the wrong order would hand everyone
 * the lowest rank without failing.
 */
export function rankForCorrectAnswers<T extends { id: string; thresholdCorrectAnswers: number }>(
  ranks: T[],
  totalCorrect: number,
): T | null {
  const eligible = ranks
    .filter((r) => totalCorrect >= r.thresholdCorrectAnswers)
    .sort((a, b) => b.thresholdCorrectAnswers - a.thresholdCorrectAnswers);
  return eligible[0] ?? null;
}
