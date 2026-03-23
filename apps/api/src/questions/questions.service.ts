import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AddToTournamentDto } from './dto/add-to-tournament.dto';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Admin: Create question with localizations ──
  async create(dto: CreateQuestionDto, adminId: string) {
    return this.prisma.question.create({
      data: {
        category: dto.category,
        theme: dto.theme || null,
        hasImage: dto.hasImage || false,
        imageUrl: dto.imageUrl || null,
        status: 'ACTIVE',
        createdBy: adminId,
        localizations: {
          create: dto.localizations.map((loc) => ({
            language: loc.language,
            questionText: loc.questionText,
            correctAnswerLocalized: loc.correctAnswer,
          })),
        },
      },
      include: { localizations: true },
    });
  }

  // ─── Admin: List all questions ────────────────
  async findAll(status?: string) {
    const where = status ? { status: status as any } : {};
    return this.prisma.question.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { localizations: true },
    });
  }

  // ─── Admin: Get one question ──────────────────
  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: { localizations: true },
    });
    if (!question) throw new NotFoundException('Вопрос не найден');
    return question;
  }

  // ─── Admin: Add question to tournament ────────
  async addToTournament(dto: AddToTournamentDto) {
    // Find max orderIndex
    const last = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId: dto.tournamentId },
      orderBy: { orderIndex: 'desc' },
    });
    const nextOrder = (last?.orderIndex ?? -1) + 1;

    return this.prisma.tournamentQuestion.create({
      data: {
        tournamentId: dto.tournamentId,
        questionId: dto.questionId,
        orderIndex: dto.orderIndex ?? nextOrder,
      },
      include: {
        question: { include: { localizations: true } },
      },
    });
  }

  // ─── Admin: Bulk add questions to tournament ──
  async bulkAddToTournament(tournamentId: string, questionIds: string[]) {
    const last = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId },
      orderBy: { orderIndex: 'desc' },
    });
    let nextOrder = (last?.orderIndex ?? -1) + 1;

    const results = [];
    for (const questionId of questionIds) {
      const tq = await this.prisma.tournamentQuestion.create({
        data: {
          tournamentId,
          questionId,
          orderIndex: nextOrder++,
        },
      });
      results.push(tq);
    }
    return results;
  }
}
