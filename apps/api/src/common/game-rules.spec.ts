import {
  MAX_SCORE,
  QUESTIONS_PER_TOURNAMENT,
  accuracyPercent,
  answeredDuringReading,
  applyJudgement,
  derivePhase,
  deriveMatchStatus,
  isMatchOver,
  rankForCorrectAnswers,
  wasDecisiveWin,
} from './game-rules';

describe('deriveMatchStatus', () => {
  it('keeps the match going until someone reaches the target', () => {
    expect(deriveMatchStatus(0, 0)).toBe('PLAYING');
    expect(deriveMatchStatus(11, 0)).toBe('PLAYING');
    expect(deriveMatchStatus(0, 11)).toBe('PLAYING');
  });

  it('ends the match at twelve points', () => {
    expect(deriveMatchStatus(MAX_SCORE, 0)).toBe('WON');
    expect(deriveMatchStatus(0, MAX_SCORE)).toBe('LOST');
  });

  it('treats 11:11 as still playing — the decider has not been asked yet', () => {
    expect(deriveMatchStatus(11, 11)).toBe('PLAYING');
  });

  it('resolves the decider', () => {
    expect(deriveMatchStatus(12, 11)).toBe('WON');
    expect(deriveMatchStatus(11, 12)).toBe('LOST');
  });

  it('never returns a draw over a full pool, because the pool is odd', () => {
    // 23 questions cannot split evenly, so FINISHED is unreachable in a normal
    // match. This test exists to catch the day someone changes the pool size to
    // an even number without noticing that draws suddenly become possible.
    expect(QUESTIONS_PER_TOURNAMENT % 2).toBe(1);

    const outcomes = new Set<string>();
    for (let user = 0; user <= QUESTIONS_PER_TOURNAMENT; user++) {
      outcomes.add(deriveMatchStatus(user, QUESTIONS_PER_TOURNAMENT - user));
    }
    expect(outcomes.has('FINISHED')).toBe(false);
  });

  it('has a draw branch that no whole-point score can reach today', () => {
    // A draw needs equal scores, which needs an even total — and 23 is odd.
    // Any score of 12 or more resolves before the total is even consulted. So
    // FINISHED is dead code under the current rules. The branch stays because
    // changing the pool size would bring it straight back to life, and this
    // test is what will say so.
    const draws: Array<[number, number]> = [];
    for (let user = 0; user <= 30; user++) {
      for (let system = 0; system <= 30; system++) {
        if (deriveMatchStatus(user, system) === 'FINISHED') draws.push([user, system]);
      }
    }
    expect(draws).toEqual([]);
  });

  it('does return a draw when the pool size allows one', () => {
    // Exercises the branch the default rules cannot reach, so that changing
    // "FINISHED" to something else is caught rather than passing silently.
    expect(deriveMatchStatus(12, 12, { maxScore: 13, poolSize: 24 })).toBe('FINISHED');
    expect(deriveMatchStatus(13, 11, { maxScore: 13, poolSize: 24 })).toBe('WON');
    expect(deriveMatchStatus(11, 13, { maxScore: 13, poolSize: 24 })).toBe('LOST');
  });

  it('is decided by the score alone, not by call order', () => {
    expect(deriveMatchStatus(12, 11)).toBe(deriveMatchStatus(12, 11));
  });
});

describe('isMatchOver', () => {
  it('recognises every terminal outcome', () => {
    expect(isMatchOver('WON')).toBe(true);
    expect(isMatchOver('LOST')).toBe(true);
    expect(isMatchOver('FINISHED')).toBe(true);
  });

  it('does not treat a match in progress as over', () => {
    expect(isMatchOver('PLAYING')).toBe(false);
    expect(isMatchOver('PENDING')).toBe(false);
    expect(isMatchOver('APPROVED')).toBe(false);
  });
});

describe('wasDecisiveWin', () => {
  it('is true only at 12:11', () => {
    expect(wasDecisiveWin(12, 11)).toBe(true);
  });

  it('is false for a comfortable win', () => {
    expect(wasDecisiveWin(12, 0)).toBe(false);
    expect(wasDecisiveWin(12, 10)).toBe(false);
  });

  it('is false before the decider is answered', () => {
    expect(wasDecisiveWin(11, 11)).toBe(false);
  });

  it('is false for the player who lost the decider', () => {
    expect(wasDecisiveWin(11, 12)).toBe(false);
  });
});

describe('applyJudgement', () => {
  it('gives the point to the player when the answer stands', () => {
    expect(applyJudgement(3, 5, 'ACCEPTED')).toEqual({ scoreUser: 4, scoreSystem: 5 });
  });

  it('gives the point to the system when it does not', () => {
    expect(applyJudgement(3, 5, 'REJECTED')).toEqual({ scoreUser: 3, scoreSystem: 6 });
  });

  it('awards exactly one point per question', () => {
    const before = 3 + 5;
    const accepted = applyJudgement(3, 5, 'ACCEPTED');
    const rejected = applyJudgement(3, 5, 'REJECTED');
    expect(accepted.scoreUser + accepted.scoreSystem).toBe(before + 1);
    expect(rejected.scoreUser + rejected.scoreSystem).toBe(before + 1);
  });
});

describe('derivePhase', () => {
  const state = { readingEndsAt: 20_000, answeringEndsAt: 50_000 };

  it('is idle without a question in flight', () => {
    expect(derivePhase(1000, null)).toEqual({ phase: 'idle', timerSeconds: 0 });
    expect(derivePhase(1000, undefined)).toEqual({ phase: 'idle', timerSeconds: 0 });
    expect(derivePhase(1000, {} as any)).toEqual({ phase: 'idle', timerSeconds: 0 });
  });

  it('reads first', () => {
    expect(derivePhase(0, state)).toEqual({ phase: 'reading', timerSeconds: 20 });
    expect(derivePhase(19_000, state)).toEqual({ phase: 'reading', timerSeconds: 1 });
  });

  it('switches to answering exactly when reading ends', () => {
    expect(derivePhase(20_000, state).phase).toBe('answering');
    expect(derivePhase(19_999, state).phase).toBe('reading');
  });

  it('counts the answering window down', () => {
    expect(derivePhase(20_000, state)).toEqual({ phase: 'answering', timerSeconds: 30 });
    expect(derivePhase(49_000, state)).toEqual({ phase: 'answering', timerSeconds: 1 });
  });

  it('moves to judging once answering is over', () => {
    expect(derivePhase(50_000, state)).toEqual({ phase: 'judging', timerSeconds: 0 });
    expect(derivePhase(999_999, state)).toEqual({ phase: 'judging', timerSeconds: 0 });
  });

  it('rounds the remaining time up, so a partial second still shows', () => {
    // Rounding down would display 0 while the phase is still running.
    expect(derivePhase(19_500, state).timerSeconds).toBe(1);
  });

  it('gives the correct phase when joining midway, not a restarted timer', () => {
    // This is what lets a reconnecting client land in the right place.
    expect(derivePhase(35_000, state)).toEqual({ phase: 'answering', timerSeconds: 15 });
  });
});

describe('answeredDuringReading', () => {
  const state = { questionId: 'q1', readingEndsAt: 20_000 };

  it('is true for an answer sent before the clock starts', () => {
    expect(answeredDuringReading(5_000, state, 'q1')).toBe(true);
  });

  it('is false once answering has begun', () => {
    expect(answeredDuringReading(20_000, state, 'q1')).toBe(false);
    expect(answeredDuringReading(35_000, state, 'q1')).toBe(false);
  });

  it('is false when the live question is a different one', () => {
    // Guards against crediting an answer against a stale question state.
    expect(answeredDuringReading(5_000, state, 'q2')).toBe(false);
  });

  it('is false with no question in flight', () => {
    expect(answeredDuringReading(5_000, null, 'q1')).toBe(false);
    expect(answeredDuringReading(5_000, { questionId: 'q1' }, 'q1')).toBe(false);
  });
});

describe('accuracyPercent', () => {
  it('is zero when nothing has been answered', () => {
    expect(accuracyPercent(0, 0)).toBe(0);
  });

  it('never divides by zero, even with a nonsense correct count', () => {
    expect(accuracyPercent(5, 0)).toBe(0);
  });

  it('keeps two decimal places', () => {
    expect(accuracyPercent(1, 3)).toBe(33.33);
    expect(accuracyPercent(2, 3)).toBe(66.67);
  });

  it('handles the clean cases', () => {
    expect(accuracyPercent(10, 10)).toBe(100);
    expect(accuracyPercent(0, 10)).toBe(0);
    expect(accuracyPercent(1, 2)).toBe(50);
  });
});

describe('rankForCorrectAnswers', () => {
  // The live ladder, as seeded.
  const ranks = [
    { id: 'wooden', thresholdCorrectAnswers: 0 },
    { id: 'bronze', thresholdCorrectAnswers: 50 },
    { id: 'silver', thresholdCorrectAnswers: 150 },
    { id: 'gold', thresholdCorrectAnswers: 300 },
    { id: 'platinum', thresholdCorrectAnswers: 500 },
    { id: 'magister', thresholdCorrectAnswers: 750 },
  ];

  it('starts everyone at the bottom rung', () => {
    expect(rankForCorrectAnswers(ranks, 0)?.id).toBe('wooden');
  });

  it('promotes exactly at the threshold, not one past it', () => {
    expect(rankForCorrectAnswers(ranks, 49)?.id).toBe('wooden');
    expect(rankForCorrectAnswers(ranks, 50)?.id).toBe('bronze');
  });

  it('picks the highest rank earned, not the first one matched', () => {
    expect(rankForCorrectAnswers(ranks, 1000)?.id).toBe('magister');
    expect(rankForCorrectAnswers(ranks, 320)?.id).toBe('gold');
  });

  it('does not depend on the order ranks arrive in', () => {
    // A query returning them ascending must not hand everyone 'wooden'.
    const shuffled = [...ranks].reverse();
    expect(rankForCorrectAnswers(shuffled, 320)?.id).toBe('gold');
  });

  it('returns null when no rank qualifies', () => {
    expect(rankForCorrectAnswers([{ id: 'x', thresholdCorrectAnswers: 10 }], 5)).toBeNull();
    expect(rankForCorrectAnswers([], 100)).toBeNull();
  });
});
