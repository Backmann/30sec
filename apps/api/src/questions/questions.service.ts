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
  async findAll(opts: { status?: string; search?: string; onlyUnused?: boolean; sort?: 'new' | 'old' } = {}) {
    const { status, search, onlyUnused, sort = 'new' } = opts;
    const where: any = {};
    if (status) where.status = status;

    // Text search in localizations (question text or correct answer)
    if (search && search.trim()) {
      where.localizations = {
        some: {
          OR: [
            { questionText: { contains: search, mode: 'insensitive' } },
            { correctAnswerLocalized: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    // Only unused (not attached to any tournament question)
    if (onlyUnused) {
      where.tournaments = { none: {} };
    }

    const questions = await this.prisma.question.findMany({
      where,
      orderBy: { createdAt: sort === 'old' ? 'asc' : 'desc' },
      include: {
        localizations: true,
        tournaments: {
          select: {
            id: true,
            isUsed: true,
            tournament: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });

    // Derive "played" flag
    return questions.map(q => ({
      ...q,
      played: q.tournaments.some(tq => tq.isUsed),
      inUpcoming: q.tournaments.some(tq => !tq.isUsed && ['DRAFT', 'SCHEDULED', 'LIVE'].includes(tq.tournament.status)),
    }));
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
  async addToTournament(dto: AddToTournamentDto & { force?: boolean }) {
    // Check if question has been played before (soft warning pattern)
    if (!dto.force) {
      const playedBefore = await this.prisma.tournamentQuestion.findFirst({
        where: {
          questionId: dto.questionId,
          isUsed: true,
        },
        include: { tournament: { select: { title: true, endAt: true } } },
      });
      if (playedBefore) {
        return {
          warning: 'ALREADY_PLAYED',
          playedIn: playedBefore.tournament.title,
          playedAt: playedBefore.tournament.endAt,
          message: `Этот вопрос уже игрался в турнире "${playedBefore.tournament.title}". Использовать снова?`,
        };
      }
    }

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

  // ─── Admin: Update question ────────────────────
  async update(id: string, dto: any) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: { localizations: true, tournaments: true },
    });
    if (!question) throw new NotFoundException('Вопрос не найден');

    // Update question fields (optional)
    const questionData: any = {};
    if (dto.category) questionData.category = dto.category;
    if (dto.theme !== undefined) questionData.theme = dto.theme || null;
    if (dto.hasImage !== undefined) questionData.hasImage = dto.hasImage;
    if (dto.imageUrl !== undefined) questionData.imageUrl = dto.imageUrl || null;

    // Update or replace localizations
    if (dto.localizations && Array.isArray(dto.localizations)) {
      // Delete all existing localizations and recreate
      await this.prisma.questionLocalization.deleteMany({
        where: { questionId: id },
      });

      for (const loc of dto.localizations) {
        if (!loc.questionText) continue; // skip empty
        await this.prisma.questionLocalization.create({
          data: {
            questionId: id,
            language: loc.language,
            questionText: loc.questionText,
            correctAnswerLocalized: loc.correctAnswer || loc.correctAnswerLocalized || '',
          },
        });
      }
    }

    if (Object.keys(questionData).length > 0) {
      await this.prisma.question.update({
        where: { id },
        data: questionData,
      });
    }

    return this.prisma.question.findUnique({
      where: { id },
      include: { localizations: true },
    });
  }

  // ─── Admin: Delete question ───────────────────
  async remove(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        tournaments: {
          include: { tournament: { select: { id: true, title: true, status: true } } },
        },
      },
    });
    if (!question) throw new NotFoundException('Вопрос не найден');

    // Check if question is in any active or upcoming tournament
    const activeTournament = question.tournaments.find(tq =>
      ['DRAFT', 'SCHEDULED', 'LIVE'].includes(tq.tournament.status)
    );
    if (activeTournament) {
      throw new NotFoundException(
        `Нельзя удалить: вопрос в турнире "${activeTournament.tournament.title}" (${activeTournament.tournament.status})`
      );
    }

    // Safe to delete: remove tournamentQuestion links first, then localizations, then question
    await this.prisma.tournamentQuestion.deleteMany({ where: { questionId: id } });
    await this.prisma.questionLocalization.deleteMany({ where: { questionId: id } });
    await this.prisma.question.delete({ where: { id } });
    return { deleted: true };
  }
}
