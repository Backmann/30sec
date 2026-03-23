import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SetReactionDto } from './dto/set-reaction.dto';

@Injectable()
export class ReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Set or change reaction ───────────────────
  async setReaction(dto: SetReactionDto, userId: string) {
    // Verify reaction type exists
    const reactionType = await this.prisma.reactionType.findUnique({
      where: { code: dto.reactionCode },
    });
    if (!reactionType || !reactionType.isActive) {
      throw new BadRequestException('Некорректный тип реакции');
    }

    // Upsert: create or update reaction
    const reaction = await this.prisma.questionReaction.upsert({
      where: {
        userId_tournamentId_questionId: {
          userId,
          tournamentId: dto.tournamentId,
          questionId: dto.questionId,
        },
      },
      update: {
        reactionCode: dto.reactionCode,
      },
      create: {
        userId,
        tournamentId: dto.tournamentId,
        questionId: dto.questionId,
        reactionCode: dto.reactionCode,
      },
    });

    return reaction;
  }

  // ─── Remove my reaction ───────────────────────
  async removeReaction(tournamentId: string, questionId: string, userId: string) {
    const existing = await this.prisma.questionReaction.findUnique({
      where: {
        userId_tournamentId_questionId: { userId, tournamentId, questionId },
      },
    });
    if (!existing) throw new NotFoundException('Реакция не найдена');

    await this.prisma.questionReaction.delete({
      where: { id: existing.id },
    });

    return { deleted: true };
  }

  // ─── Get reactions for a question ─────────────
  async getReactions(tournamentId: string, questionId: string) {
    const reactions = await this.prisma.questionReaction.groupBy({
      by: ['reactionCode'],
      where: { tournamentId, questionId },
      _count: { reactionCode: true },
    });

    return reactions.map((r) => ({
      code: r.reactionCode,
      count: r._count.reactionCode,
    }));
  }

  // ─── Get available reaction types ─────────────
  async getReactionTypes() {
    return this.prisma.reactionType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
