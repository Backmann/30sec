import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

@Injectable()
export class AnswersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Player: Submit answer ────────────────────
  async submit(dto: SubmitAnswerDto, userId: string) {
    // Check tournament is LIVE
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status !== 'LIVE') {
      throw new BadRequestException('Турнир не активен');
    }

    // Check user is participant
    const participant = await this.prisma.tournamentParticipant.findUnique({
      where: {
        userId_tournamentId: { userId, tournamentId: dto.tournamentId },
      },
    });
    if (!participant) throw new ForbiddenException('Вы не участник этого турнира');

    // Check match not already finished
    if (participant.matchStatus === 'WON' || participant.matchStatus === 'LOST' || participant.matchStatus === 'FINISHED') {
      throw new BadRequestException('Ваш матч уже завершён');
    }

    // Check not already answered
    const existing = await this.prisma.answer.findUnique({
      where: {
        tournamentId_questionId_userId: {
          tournamentId: dto.tournamentId,
          questionId: dto.questionId,
          userId,
        },
      },
    });
    if (existing) throw new BadRequestException('Вы уже ответили на этот вопрос');

    // Create answer
    const answer = await this.prisma.answer.create({
      data: {
        userId,
        tournamentId: dto.tournamentId,
        questionId: dto.questionId,
        answerText: dto.answerText.trim().substring(0, 50),
      },
    });

    // Update participant status to PLAYING
    if (participant.matchStatus === 'REGISTERED') {
      await this.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { matchStatus: 'PLAYING' },
      });
    }

    // Emit to admin
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    this.realtime.answerSubmitted(dto.tournamentId, {
      answerId: answer.id,
      userId,
      nickname: profile?.nickname || 'unknown',
      answerText: answer.answerText,
    });

    return { id: answer.id, answerText: answer.answerText, submittedAt: answer.submittedAt };
  }

  // ─── Admin: Get answers for a question in tournament ──
  async getAnswersForQuestion(tournamentId: string, questionId: string) {
    return this.prisma.answer.findMany({
      where: { tournamentId, questionId },
      include: {
        user: {
          include: {
            profile: { select: { nickname: true, flagCode: true } },
          },
        },
        judgement: true,
        aiAssist: true,
      },
      orderBy: { submittedAt: 'asc' },
    });
  }

  // ─── Player: Get my answers in tournament ─────
  async getMyAnswers(tournamentId: string, userId: string) {
    return this.prisma.answer.findMany({
      where: { tournamentId, userId },
      include: {
        judgement: true,
        question: {
          include: { localizations: true },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });
  }
}
