import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { GameStateStore } from './game-state.store';

@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  // Map<tournamentId, { readingTimeout, answerInterval?, data }>
  private activeTimers = new Map<string, any>();

  // Map<tournamentId, { questionId, judgements: judgementData[], correctAnswer }>
  // Buffers individual player judgements until ALL players are judged or the
  // answering timer ends, then reveals them as one synchronized event so a
  // fast-correct answer can never tip off other players still thinking.
  private pendingReveals = new Map<string, { questionId: string; judgements: any[]; correctAnswer: string }>();

  constructor(
    private readonly gateway: GameGateway,
    private readonly prisma: PrismaService,
    private readonly stateStore: GameStateStore,
  ) {}

  /**
   * Re-arm everything a restart interrupted.
   *
   * Timers were setTimeout/setInterval closures inside this process, so a
   * container restart froze any running question forever. The stored state
   * carries absolute deadlines (readingEndsAt / answeringEndsAt), which is what
   * makes recovery possible: we work out where the question is NOW and pick the
   * schedule back up — or, if both deadlines already passed while we were down,
   * close the question immediately.
   */
  async onModuleInit() {
    const states = await this.stateStore.loadAll();
    if (states.size === 0) return;

    this.gateway.hydrateGameStates(states);

    for (const [tournamentId, state] of states.entries()) {
      if (!state?.questionId || state.phase === 'locked') continue;
      try {
        this.armQuestionTimers(
          tournamentId,
          state.questionId,
          state.readingEndsAt,
          state.answeringEndsAt,
        );
        this.logger.log(`Resumed question for tournament ${tournamentId}`);
      } catch (err) {
        this.logger.warn(`Could not resume ${tournamentId}: ${err.message}`);
      }
    }
  }

  /**
   * Drive one question from wherever it currently is to its end.
   *
   * Shared by a fresh question, an extended reading phase and a restart
   * recovery, so all three can never drift apart. Remaining time is always
   * derived from the absolute deadlines rather than counted down from a fixed
   * number — that is what lets it start mid-phase, and it also stops the
   * displayed timer drifting when a tick is late.
   */
  private armQuestionTimers(
    tournamentId: string,
    questionId: string,
    readingEndsAt: number,
    answeringEndsAt: number,
  ) {
    const prev = this.activeTimers.get(tournamentId);
    if (prev) {
      if (prev.readingTimeout) clearTimeout(prev.readingTimeout);
      if (prev.answerInterval) clearInterval(prev.answerInterval);
    }

    const entry: any = { data: { questionId } };

    const startAnswering = () => {
      this.gateway.setGamePhase(tournamentId, 'answering');
      const secondsLeft = Math.max(0, Math.ceil((answeringEndsAt - Date.now()) / 1000));
      this.gateway.emitPhaseChanged(tournamentId, 'answering', secondsLeft);

      const iv = setInterval(() => {
        const left = Math.max(0, Math.ceil((answeringEndsAt - Date.now()) / 1000));
        if (left > 0) {
          this.gateway.emitTimerTick(tournamentId, left, 'answering');
        } else {
          clearInterval(iv);
          this.gateway.emitQuestionLocked(tournamentId);
          this.gateway.setGamePhase(tournamentId, 'locked');
          this.autoRejectMissing(tournamentId, questionId);
          this.activeTimers.delete(tournamentId);
        }
      }, 1000);
      entry.answerInterval = iv;
    };

    const now = Date.now();

    if (now >= answeringEndsAt) {
      // Both deadlines passed while the process was down — close it out now
      // rather than leaving players staring at a dead question.
      this.gateway.emitQuestionLocked(tournamentId);
      this.gateway.setGamePhase(tournamentId, 'locked');
      this.autoRejectMissing(tournamentId, questionId);
      this.activeTimers.delete(tournamentId);
      return;
    }

    if (now >= readingEndsAt) {
      startAnswering();
    } else {
      entry.readingTimeout = setTimeout(startAnswering, readingEndsAt - now);
    }

    this.activeTimers.set(tournamentId, entry);
  }

  /** Admin: extend reading phase by N seconds (only during reading) */
  extendReading(tournamentId: string, extraSeconds: number = 10): boolean {
    const entry = this.activeTimers.get(tournamentId);
    if (!entry || !entry.readingTimeout) return false;
    clearTimeout(entry.readingTimeout);
    const gs = this.gateway.getGameState(tournamentId);
    if (!gs) return false;
    const newReadingEnds = gs.readingEndsAt + extraSeconds * 1000;
    const newAnsweringEnds = gs.answeringEndsAt + extraSeconds * 1000;
    this.gateway.setGameState(tournamentId, {
      ...gs,
      readingEndsAt: newReadingEnds,
      answeringEndsAt: newAnsweringEnds,
    });
    const remainingMs = newReadingEnds - Date.now();
    this.gateway.emitPhaseChanged(tournamentId, 'reading', Math.ceil(remainingMs / 1000));
    this.armQuestionTimers(
      tournamentId,
      entry.data?.questionId ?? gs.questionId,
      newReadingEnds,
      newAnsweringEnds,
    );
    return true;
  }

  broadcastTournamentListUpdate() {
    this.gateway.emitGlobal('tournaments_updated', { timestamp: Date.now() });
  }

  tournamentStarted(tournamentId: string, data: any) {
    this.gateway.emitTournamentStarted(tournamentId, data);
  }

  tournamentFinished(tournamentId: string) {
    // Stop any in-flight timers (reading/answering) — otherwise they keep
    // emitting tick events to a tournament that's no longer running.
    const entry = this.activeTimers.get(tournamentId);
    if (entry) {
      if (entry.readingTimeout) clearTimeout(entry.readingTimeout);
      if (entry.answerInterval) clearInterval(entry.answerInterval);
      this.activeTimers.delete(tournamentId);
    }
    // Clear pending reveal — won't be flushed since round is over
    this.pendingReveals.delete(tournamentId);
    // Clear the cached game state so reconnects don't see stale question data.
    this.gateway.clearGameState(tournamentId);
    this.gateway.emitTournamentFinished(tournamentId);
  }

  // Question flow: show question -> 20 s reading -> 30s answer -> lock -> auto-reject empty
  questionStarted(tournamentId: string, data: {
    tournamentQuestionId?: string; questionId?: string; orderIndex: number;
    category: string;
    localizations: { language: string; questionText: string }[];
    questionImages?: any[];
  }) {
    // Store current question state for reconnect
    const startedAt = Date.now();
    const readingEndsAt = startedAt + 20000;
    const answeringEndsAt = startedAt + 50000;

    this.gateway.setGameState(tournamentId, {
      questionId: data.questionId,
      orderIndex: data.orderIndex,
      localizations: data.localizations,
      phase: 'reading',
      startedAt,
      readingEndsAt,
      answeringEndsAt,
    });

    // New question — wipe any leftover reveal buffer from a previous question
    this.pendingReveals.delete(tournamentId);

    // Phase 1: Show question (reading)
    this.gateway.emitQuestionStarted(tournamentId, {
      ...data, phase: 'reading', timerSeconds: 0,
    });

    // One shared code path for fresh questions, extended reading and restart
    // recovery — three schedules that must never disagree.
    this.armQuestionTimers(
      tournamentId,
      data.questionId!,
      readingEndsAt,
      answeringEndsAt,
    );
  }

  // Auto-create empty answers and auto-reject for missing players (OPTIMIZED)
  private async autoRejectMissing(tournamentId: string, questionId: string) {
    try {
      // 1. Get all active participants in ONE query
      const participants = await this.prisma.tournamentParticipant.findMany({
        where: { tournamentId, matchStatus: { in: ['PLAYING', 'APPROVED'] } },
        include: { user: { include: { profile: { select: { nickname: true } } } } },
      });
      if (participants.length === 0) return;

      // 2. Get ALL existing answers for this question in ONE query
      const existingAnswers = await this.prisma.answer.findMany({
        where: { tournamentId, questionId },
        select: { userId: true },
      });
      const answeredUserIds = new Set(existingAnswers.map(a => a.userId));

      // 3. Filter to only missing players
      const missing = participants.filter(p => !answeredUserIds.has(p.userId));
      if (missing.length === 0) return;

      // 4. Get correct answer once (not per player)
      const questionLoc = await this.prisma.questionLocalization.findFirst({
        where: { questionId },
      });

      // 5. Process all missing players in parallel (batch)
      await Promise.all(missing.map(async (p) => {
        // Create empty answer
        const answer = await this.prisma.answer.create({
          data: { userId: p.userId, tournamentId, questionId, answerText: '' },
        });

        // Notify admin
        this.gateway.emitAnswerSubmitted(tournamentId, {
          answerId: answer.id, userId: p.userId,
          nickname: p.user?.profile?.nickname || 'unknown',
          answerText: '(no answer)',
        });

        // Create auto-judgement
        await this.prisma.judgement.create({
          data: { answerId: answer.id, judgeId: p.userId, decision: 'REJECTED', reasonCode: 'NO_ANSWER', judgedAt: new Date() },
        });

        // Update score
        let scoreSystem = p.currentScoreSystem + 1;
        let scoreUser = p.currentScoreUser;
        let matchStatus = p.matchStatus;

        if (scoreSystem >= 12) matchStatus = 'LOST';
        else if (scoreUser + scoreSystem >= 23) {
          matchStatus = scoreUser > scoreSystem ? 'WON' : scoreUser < scoreSystem ? 'LOST' : 'FINISHED';
        }

        // Batch: update participant + stats in parallel
        await Promise.all([
          this.prisma.tournamentParticipant.update({
            where: { id: p.id },
            data: { currentScoreSystem: scoreSystem, matchStatus: matchStatus as any,
              ...(matchStatus === 'LOST' || matchStatus === 'FINISHED' ? { finishedAt: new Date() } : {}),
            },
          }),
          this.prisma.playerStat.updateMany({
            where: { userId: p.userId },
            data: { totalAnswered: { increment: 1 }, totalWrong: { increment: 1 }, currentStreak: 0 },
          }),
        ]);

        // Emit judgement to player (buffered — will be flushed by flushReveal below)
        await this.judgementReady(tournamentId, {
          userId: p.userId, answerId: answer.id, decision: 'REJECTED',
          correctAnswer: questionLoc?.correctAnswerLocalized || '',
          scoreUser, scoreSystem, matchStatus,
          questionId,
        });
      }));

      // Timer ended — flush whatever judgements are buffered, including the
      // ones we just created for missing players AND any earlier judge
      // decisions that have been waiting silently.
      this.flushReveal(tournamentId);
    } catch (err) {
      console.error('Auto-reject error:', err);
    }
  }

  answerSubmitted(tournamentId: string, data: { answerId: string; userId: string; nickname: string; answerText: string }) {
    // Admin sees full answer text (for grading)
    this.gateway.emitAnswerSubmitted(tournamentId, data);
    // Room (players + spectators) sees only "this user answered" — used for avatar coloring
    // and for the answering player's own "Ответ принят, ждём раскрытия" panel.
    this.gateway.emitAnswerStatus(tournamentId, data.userId);
  }

  allAnswersSubmitted(tournamentId: string) {
    this.gateway.emitAllAnswersSubmitted(tournamentId);
  }

  /**
   * Buffer a judgement for the current question, then check if it's time to reveal.
   * Reveal trigger: all active players for this tournament have been judged.
   * Otherwise, the answering timer's expiry (autoRejectMissing) will flush whatever
   * is in the buffer.
   *
   * Admin always gets the judgement immediately for their grading UI.
   */
  async judgementReady(tournamentId: string, data: {
    userId: string; answerId: string; decision: string; correctAnswer: string;
    scoreUser: number; scoreSystem: number; matchStatus: string;
    questionId?: string;
  }) {
    // Admin sees it now (no fairness concern — admin already knows the answer).
    this.gateway.emitJudgementReady(tournamentId, data);

    // Match-finished broadcast can stay public (it's just W/L, no answer).
    if (['WON', 'LOST', 'FINISHED'].includes(data.matchStatus)) {
      this.gateway.emitMatchFinished(tournamentId, {
        userId: data.userId, matchStatus: data.matchStatus,
        finalScoreUser: data.scoreUser, finalScoreSystem: data.scoreSystem,
      });
    }

    // Buffer for synchronized reveal.
    let buf = this.pendingReveals.get(tournamentId);
    if (!buf) {
      // First judgement of this question — initialize buffer.
      const questionId = data.questionId
        || this.gateway.getGameState(tournamentId)?.questionId
        || '';
      buf = { questionId, judgements: [], correctAnswer: data.correctAnswer };
      this.pendingReveals.set(tournamentId, buf);
    }
    // Update correct answer if we got it later
    if (!buf.correctAnswer && data.correctAnswer) buf.correctAnswer = data.correctAnswer;
    // Skip duplicate (same user already buffered for this question)
    if (!buf.judgements.some(j => j.userId === data.userId)) {
      buf.judgements.push(data);
    }

    // Check if all currently-active players (still APPROVED/PLAYING — not WON/LOST/FINISHED
    // before this question) have been judged.
    const totalActive = await this.prisma.tournamentParticipant.count({
      where: { tournamentId, matchStatus: { in: ['PLAYING', 'APPROVED'] } },
    });
    // Also count those who finished THIS question (matchStatus changed during this call).
    const finishedThisQuestion = buf.judgements.filter(j =>
      ['WON', 'LOST', 'FINISHED'].includes(j.matchStatus),
    ).length;
    if (buf.judgements.length >= totalActive + finishedThisQuestion) {
      // Everyone judged — reveal early, don't wait for timer.
      this.flushReveal(tournamentId);
    }
  }

  /**
   * Send the buffered judgements to the entire room as one synchronized event.
   * Idempotent — safe to call from both "all judged" and "timer expired" triggers.
   */
  private flushReveal(tournamentId: string) {
    const buf = this.pendingReveals.get(tournamentId);
    if (!buf || buf.judgements.length === 0) return;
    this.gateway.emitJudgementsRevealed(tournamentId, {
      judgements: buf.judgements,
      correctAnswer: buf.correctAnswer,
    });
    this.pendingReveals.delete(tournamentId);
  }

  /** Admin-only emit for cases like UNDO where we don't want to surface anything to players. */
  adminOnlyJudgement(tournamentId: string, data: any) {
    this.gateway.emitJudgementReady(tournamentId, data);
  }

  reactionsUpdated(tournamentId: string, questionId: string, reactions: any[]) {
    this.gateway.emitReactionUpdated(tournamentId, questionId, reactions);
  }

  getOnlineCount(tournamentId?: string): number {
    return this.gateway.getOnlineCount(tournamentId);
  }

  // For reconnect: get current game state
  getGameState(tournamentId: string) {
    return this.gateway.getGameState(tournamentId);
  }
}
