import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GameGateway } from '../realtime/game.gateway';
import { SaveSpectatorAnswerDto } from './dto/save-spectator-answer.dto';

@Injectable()
export class SpectatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameGateway: GameGateway,
  ) {}

  // ─── Save personal answer (spectator) ─────────
  async saveAnswer(dto: SaveSpectatorAnswerDto, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');

    // Fairness gate: only accept if THIS question is the one currently being asked,
    // AND we're still in a phase where players can be submitting (reading/answering).
    // After lock — when the reveal has started or is about to — we don't accept
    // new spectator answers, so a tech-savvy viewer can't POST after seeing the
    // reveal text and have it count as a pre-reveal try.
    if (tournament.status !== 'LIVE') {
      throw new BadRequestException('Турнир не идёт');
    }
    const liveState = this.gameGateway.getGameState(dto.tournamentId);
    if (!liveState || liveState.questionId !== dto.questionId) {
      throw new BadRequestException('Этот вопрос больше не активен');
    }
    if (liveState.phase !== 'reading' && liveState.phase !== 'answering') {
      throw new BadRequestException('Время ответа истекло');
    }

    // Check not already saved
    const existing = await this.prisma.spectatorAnswer.findUnique({
      where: {
        userId_tournamentId_questionId: {
          userId,
          tournamentId: dto.tournamentId,
          questionId: dto.questionId,
        },
      },
    });
    if (existing) throw new BadRequestException('Вы уже сохранили ответ на этот вопрос');

    const answer = await this.prisma.spectatorAnswer.create({
      data: {
        userId,
        tournamentId: dto.tournamentId,
        questionId: dto.questionId,
        answerText: dto.answerText.trim().substring(0, 100),
      },
    });

    // Update spectator stats
    await this.prisma.spectatorStat.upsert({
      where: { userId },
      update: { savedPersonalAnswers: { increment: 1 } },
      create: { userId, savedPersonalAnswers: 1 },
    });

    return answer;
  }

  // ─── Get my spectator answers for a tournament ──
  async getMyAnswers(tournamentId: string, userId: string) {
    return this.prisma.spectatorAnswer.findMany({
      where: { tournamentId, userId },
      include: {
        question: {
          include: { localizations: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Get live tournament state (public) ───────
  async getLiveState(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          orderBy: { currentScoreUser: 'desc' },
          include: {
            user: {
              include: {
                profile: { select: { nickname: true, flagCode: true } },
              },
            },
          },
        },
        _count: { select: { participants: true } },
      },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');

    // Get current question text ONLY if a question is actively running.
    // The realtime gateway tracks live game state in memory; when the admin
    // launches a question, gameStates[tournamentId] is set with the active
    // question id. Without that, we must NOT leak future question text —
    // even if the next-in-line tournamentQuestion exists in DB.
    let currentQuestion: any = null;
    if (tournament.status === 'LIVE') {
      const liveState = this.gameGateway.getGameState(tournamentId);
      if (liveState && liveState.questionId) {
        const tq = await this.prisma.tournamentQuestion.findFirst({
          where: { tournamentId, questionId: liveState.questionId },
          include: {
            question: {
              include: {
                localizations: {
                  select: {
                    language: true,
                    questionText: true,
                    // NO correctAnswerLocalized — hidden from spectators
                  },
                },
              },
            },
          },
        });
        if (tq) {
          currentQuestion = {
            orderIndex: tq.orderIndex,
            category: tq.question.category,
            localizations: tq.question.localizations,
          };
        }
      }
    }

    // Count used questions
    const usedCount = await this.prisma.tournamentQuestion.count({
      where: { tournamentId, isUsed: true },
    });
    const totalQuestions = await this.prisma.tournamentQuestion.count({
      where: { tournamentId },
    });

    // Distinct spectators who answered at least one question — social proof
    // for the live viewer ("X others are watching"). Approximation: if no
    // questions were played yet, this will be 0; that's fine — we hide
    // the counter in UI when below a threshold anyway.
    const spectators = await this.prisma.spectatorAnswer.findMany({
      where: { tournamentId },
      select: { userId: true },
      distinct: ['userId'],
    });
    const spectatorCount = spectators.length;

    return {
      id: tournament.id,
      title: tournament.title,
      type: tournament.type,
      status: tournament.status,
      startAt: tournament.startAt,
      playersCount: tournament._count.participants,
      spectatorCount,
      questionsProgress: { used: usedCount, total: totalQuestions },
      participants: tournament.participants.map((p) => ({
        userId: p.userId,
        nickname: p.user.profile?.nickname || 'unknown',
        flagCode: p.user.profile?.flagCode || null,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
        matchStatus: p.matchStatus,
      })),
      currentQuestion,
    };
  }

  // ─── My spectator history (all tournaments) ───
  async getMyHistory(userId: string) {
    const answers = await this.prisma.spectatorAnswer.findMany({
      where: { userId },
      include: {
        tournament: { select: { id: true, title: true, type: true } },
        question: {
          include: { localizations: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return answers;
  }
}
