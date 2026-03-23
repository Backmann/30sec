import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveSpectatorAnswerDto } from './dto/save-spectator-answer.dto';

@Injectable()
export class SpectatorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Save personal answer (spectator) ─────────
  async saveAnswer(dto: SaveSpectatorAnswerDto, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');

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

    // Get current question (without correct answer!)
    const currentQuestion = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId, isUsed: false },
      orderBy: { orderIndex: 'asc' },
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

    // Count used questions
    const usedCount = await this.prisma.tournamentQuestion.count({
      where: { tournamentId, isUsed: true },
    });
    const totalQuestions = await this.prisma.tournamentQuestion.count({
      where: { tournamentId },
    });

    return {
      id: tournament.id,
      title: tournament.title,
      type: tournament.type,
      status: tournament.status,
      startAt: tournament.startAt,
      playersCount: tournament._count.participants,
      questionsProgress: { used: usedCount, total: totalQuestions },
      participants: tournament.participants.map((p) => ({
        nickname: p.user.profile?.nickname || 'unknown',
        flagCode: p.user.profile?.flagCode || null,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
        matchStatus: p.matchStatus,
      })),
      currentQuestion: currentQuestion
        ? {
            orderIndex: currentQuestion.orderIndex,
            category: currentQuestion.question.category,
            localizations: currentQuestion.question.localizations,
          }
        : null,
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
