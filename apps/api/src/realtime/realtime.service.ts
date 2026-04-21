import { Injectable } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RealtimeService {
  constructor(
    private readonly gateway: GameGateway,
    private readonly prisma: PrismaService,
  ) {}

  broadcastTournamentListUpdate() {
    this.gateway.emitGlobal('tournaments_updated', { timestamp: Date.now() });
  }

  tournamentStarted(tournamentId: string, data: any) {
    this.gateway.emitTournamentStarted(tournamentId, data);
  }

  tournamentFinished(tournamentId: string) {
    this.gateway.emitTournamentFinished(tournamentId);
  }

  // Question flow: show question -> 15s reading -> 30s answer -> lock -> auto-reject empty
  questionStarted(tournamentId: string, data: {
    tournamentQuestionId?: string; questionId?: string; orderIndex: number;
    category: string;
    localizations: { language: string; questionText: string }[];
    questionImages?: any[];
  }) {
    // Store current question state for reconnect
    this.gateway.setGameState(tournamentId, {
      questionId: data.questionId,
      orderIndex: data.orderIndex,
      localizations: data.localizations,
      phase: 'reading',
      startedAt: Date.now(),
      readingEndsAt: Date.now() + 20000,
      answeringEndsAt: Date.now() + 50000,
    });

    // Phase 1: Show question (reading)
    this.gateway.emitQuestionStarted(tournamentId, {
      ...data, phase: 'reading', timerSeconds: 0,
    });

    // After 15s: start answering phase
    setTimeout(() => {
      this.gateway.setGamePhase(tournamentId, 'answering');
      this.gateway.emitPhaseChanged(tournamentId, 'answering', 30);

      let left = 30;
      const iv = setInterval(() => {
        left--;
        if (left > 0) {
          this.gateway.emitTimerTick(tournamentId, left, 'answering');
        } else {
          this.gateway.emitQuestionLocked(tournamentId);
          this.gateway.setGamePhase(tournamentId, 'locked');
          clearInterval(iv);

          // Auto-create empty answers for players who didn't respond
          this.autoRejectMissing(tournamentId, data.questionId!);
        }
      }, 1000);
    }, 20000);
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

        // Emit judgement to player
        this.judgementReady(tournamentId, {
          userId: p.userId, answerId: answer.id, decision: 'REJECTED',
          correctAnswer: questionLoc?.correctAnswerLocalized || '',
          scoreUser, scoreSystem, matchStatus,
        });
      }));
    } catch (err) {
      console.error('Auto-reject error:', err);
    }
  }

  answerSubmitted(tournamentId: string, data: { answerId: string; userId: string; nickname: string; answerText: string }) {
    this.gateway.emitAnswerSubmitted(tournamentId, data);
  }

  allAnswersSubmitted(tournamentId: string) {
    this.gateway.emitAllAnswersSubmitted(tournamentId);
  }

  judgementReady(tournamentId: string, data: {
    userId: string; answerId: string; decision: string; correctAnswer: string;
    scoreUser: number; scoreSystem: number; matchStatus: string;
  }) {
    this.gateway.emitJudgementReady(tournamentId, data);
    if (['WON', 'LOST', 'FINISHED'].includes(data.matchStatus)) {
      this.gateway.emitMatchFinished(tournamentId, {
        userId: data.userId, matchStatus: data.matchStatus,
        finalScoreUser: data.scoreUser, finalScoreSystem: data.scoreSystem,
      });
    }
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
