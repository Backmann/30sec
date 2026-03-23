import { Injectable } from '@nestjs/common';
import { GameGateway } from './game.gateway';

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: GameGateway) {}

  // ─── Tournament events ────────────────────────

  tournamentStarted(tournamentId: string, data: any) {
    this.gateway.emitTournamentStarted(tournamentId, data);
  }

  tournamentFinished(tournamentId: string) {
    this.gateway.emitTournamentFinished(tournamentId);
  }

  // ─── Question events ──────────────────────────

  questionStarted(tournamentId: string, data: {
    orderIndex: number;
    category: string;
    localizations: { language: string; questionText: string }[];
  }) {
    this.gateway.emitQuestionStarted(tournamentId, {
      ...data,
      timerSeconds: 30,
    });

    // Start countdown
    let seconds = 30;
    const interval = setInterval(() => {
      seconds--;
      if (seconds > 0) {
        this.gateway.emitTimerTick(tournamentId, seconds);
      } else {
        this.gateway.emitQuestionLocked(tournamentId);
        clearInterval(interval);
      }
    }, 1000);
  }

  // ─── Answer events ────────────────────────────

  answerSubmitted(tournamentId: string, data: {
    answerId: string;
    userId: string;
    nickname: string;
    answerText: string;
  }) {
    this.gateway.emitAnswerSubmitted(tournamentId, data);
  }

  allAnswersSubmitted(tournamentId: string) {
    this.gateway.emitAllAnswersSubmitted(tournamentId);
  }

  // ─── Judgement events ─────────────────────────

  judgementReady(tournamentId: string, data: {
    userId: string;
    answerId: string;
    decision: string;
    correctAnswer: string;
    scoreUser: number;
    scoreSystem: number;
    matchStatus: string;
  }) {
    this.gateway.emitJudgementReady(tournamentId, data);

    // If match is over, emit match_finished
    if (['WON', 'LOST', 'FINISHED'].includes(data.matchStatus)) {
      this.gateway.emitMatchFinished(tournamentId, {
        userId: data.userId,
        matchStatus: data.matchStatus,
        finalScoreUser: data.scoreUser,
        finalScoreSystem: data.scoreSystem,
      });
    }
  }

  // ─── Reaction events ──────────────────────────

  reactionsUpdated(tournamentId: string, questionId: string, reactions: any[]) {
    this.gateway.emitReactionUpdated(tournamentId, questionId, reactions);
  }

  // ─── Stats ────────────────────────────────────

  getOnlineCount(tournamentId?: string): number {
    return this.gateway.getOnlineCount(tournamentId);
  }
}
