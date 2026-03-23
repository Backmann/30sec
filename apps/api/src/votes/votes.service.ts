import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CastVoteDto } from './dto/cast-vote.dto';

@Injectable()
export class VotesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Cast vote for best question ──────────────
  async castVote(dto: CastVoteDto, userId: string) {
    // Tournament must be FINISHED
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status !== 'FINISHED') {
      throw new BadRequestException('Голосование доступно только после завершения турнира');
    }

    // User must be a participant
    const participant = await this.prisma.tournamentParticipant.findUnique({
      where: {
        userId_tournamentId: { userId, tournamentId: dto.tournamentId },
      },
    });
    if (!participant) {
      throw new ForbiddenException('Голосовать могут только участники турнира');
    }

    // Check not already voted
    const existing = await this.prisma.questionVote.findUnique({
      where: {
        tournamentId_voterUserId: {
          tournamentId: dto.tournamentId,
          voterUserId: userId,
        },
      },
    });
    if (existing) throw new BadRequestException('Вы уже проголосовали в этом турнире');

    // Question must be in this tournament
    const tq = await this.prisma.tournamentQuestion.findFirst({
      where: {
        tournamentId: dto.tournamentId,
        questionId: dto.questionId,
      },
    });
    if (!tq) throw new BadRequestException('Этот вопрос не из данного турнира');

    return this.prisma.questionVote.create({
      data: {
        tournamentId: dto.tournamentId,
        voterUserId: userId,
        questionId: dto.questionId,
      },
    });
  }

  // ─── Get vote results for tournament ──────────
  async getResults(tournamentId: string) {
    const votes = await this.prisma.questionVote.groupBy({
      by: ['questionId'],
      where: { tournamentId },
      _count: { questionId: true },
      orderBy: { _count: { questionId: 'desc' } },
    });

    // Enrich with question data
    const results = [];
    for (const v of votes) {
      const question = await this.prisma.question.findUnique({
        where: { id: v.questionId },
        include: { localizations: { select: { language: true, questionText: true } } },
      });
      results.push({
        questionId: v.questionId,
        votes: v._count.questionId,
        question: question
          ? {
              category: question.category,
              localizations: question.localizations,
            }
          : null,
      });
    }

    return results;
  }

  // ─── Check if user already voted ──────────────
  async hasVoted(tournamentId: string, userId: string) {
    const vote = await this.prisma.questionVote.findUnique({
      where: {
        tournamentId_voterUserId: { tournamentId, voterUserId: userId },
      },
    });
    return { hasVoted: !!vote, questionId: vote?.questionId || null };
  }
}
