import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AddToTournamentDto } from './dto/add-to-tournament.dto';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService, private readonly uploads: UploadsService,
    private readonly achievements: AchievementsService,
  ) {}

  // ─── Admin: Create question with localizations ──
  async create(dto: CreateQuestionDto, adminId: string) {
    const result = await this.prisma.question.create({
      data: {
        category: dto.category,
        theme: dto.theme || null,
        status: 'ACTIVE',
        createdBy: adminId,
        localizations: {
          create: dto.localizations.map((loc) => ({
            language: loc.language,
            questionText: loc.questionText,
            correctAnswerLocalized: loc.correctAnswer,
          })),
        },
        questionImages: dto.questionImages && dto.questionImages.length > 0 ? {
          create: dto.questionImages.map((img, i) => ({
            url: img.url,
            r2Key: img.r2Key,
            orderIndex: img.orderIndex ?? i,
            caption: img.caption || null,
          })),
        } : undefined,
        answerImages: dto.answerImages && dto.answerImages.length > 0 ? {
          create: dto.answerImages.map((img, i) => ({
            url: img.url,
            r2Key: img.r2Key,
            orderIndex: img.orderIndex ?? i,
            caption: img.caption || null,
          })),
        } : undefined,
      },
      include: { localizations: true, questionImages: true, answerImages: true },
    });
    this.achievements.onQuestionCreated(adminId).catch(() => {});
    return result;
  }

  // ─── Admin: List all questions ────────────────
  async findAll(opts: { status?: string; search?: string; onlyUnused?: boolean; sort?: 'new' | 'old'; location?: 'library' | 'archive' | 'all'; tournamentId?: string } = {}) {
    const { status, search, onlyUnused, sort = 'new', location = 'all', tournamentId } = opts;
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

    // Location filter
    if (location === 'library') {
      // Free questions: not in any tournament-question link (not attached anywhere)
      where.tournaments = { none: {} };
    } else if (location === 'archive') {
      // Archive: played at least once (isUsed=true somewhere)
      where.tournaments = { some: { isUsed: true, ...(tournamentId ? { tournamentId } : {}) } };
    }

    // Only unused (legacy flag, same as location=library)
    if (onlyUnused && location === 'all') {
      where.tournaments = { none: {} };
    }

    const questions = await this.prisma.question.findMany({
      where,
      orderBy: { createdAt: sort === 'old' ? 'asc' : 'desc' },
      include: {
        localizations: true,
        questionImages: { orderBy: { orderIndex: 'asc' } },
        answerImages: { orderBy: { orderIndex: 'asc' } },
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
      include: {
        localizations: true,
        questionImages: { orderBy: { orderIndex: 'asc' } },
        answerImages: { orderBy: { orderIndex: 'asc' } },
      },
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

  // ─── Admin: Auto-fill tournament with random unused questions ──
  async autoFillTournament(tournamentId: string, count: number = 23) {
    const existing = await this.prisma.tournamentQuestion.findMany({
      where: { tournamentId },
      select: { questionId: true },
    });
    const existingIds = new Set(existing.map(tq => tq.questionId));
    const needed = count - existing.length;
    if (needed <= 0) {
      throw new BadRequestException(`Турнир уже заполнен: ${existing.length}/${count}`);
    }
    const candidates = await this.prisma.question.findMany({
      where: {
        id: { notIn: Array.from(existingIds) },
        status: 'ACTIVE',
        tournaments: {
          none: {
            tournament: { status: { in: ['DRAFT', 'SCHEDULED', 'LIVE'] } },
          },
        },
      },
      select: { id: true },
    });
    if (candidates.length === 0) {
      throw new BadRequestException('В библиотеке нет свободных вопросов для заполнения');
    }
    // Add as many as we can (up to needed)
    const toAdd = Math.min(needed, candidates.length);
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    const pickedIds = shuffled.slice(0, toAdd).map(q => q.id);
    const added = await this.bulkAddToTournament(tournamentId, pickedIds);
    const total = existing.length + added.length;
    const stillNeeded = count - total;
    return {
      added: added.length,
      total,
      target: count,
      stillNeeded: stillNeeded > 0 ? stillNeeded : 0,
      partial: stillNeeded > 0,
    };
  }

  // Get count of free questions in library (available for any tournament)
  async countFreeQuestions() {
    return this.prisma.question.count({
      where: {
        status: 'ACTIVE',
        tournaments: {
          none: {
            tournament: { status: { in: ['DRAFT', 'SCHEDULED', 'LIVE'] } },
          },
        },
      },
    });
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

    // Replace question images (with R2 cleanup of removed ones)
    if (dto.questionImages !== undefined && Array.isArray(dto.questionImages)) {
      const newKeys = new Set(dto.questionImages.map((img: any) => img.r2Key));
      const oldImages = await this.prisma.questionImage.findMany({ where: { questionId: id }, select: { r2Key: true } });
      const keysToRemove = oldImages.filter(img => !newKeys.has(img.r2Key)).map(img => img.r2Key);

      await this.prisma.questionImage.deleteMany({ where: { questionId: id } });
      if (dto.questionImages.length > 0) {
        await this.prisma.questionImage.createMany({
          data: dto.questionImages.map((img: any, i: number) => ({
            questionId: id,
            url: img.url,
            r2Key: img.r2Key,
            orderIndex: img.orderIndex ?? i,
            caption: img.caption || null,
          })),
        });
      }
      for (const key of keysToRemove) {
        try { await this.uploads.deleteObject(key); } catch (e) { console.error('R2 cleanup fail', key, e); }
      }
    }

    // Replace answer images (with R2 cleanup of removed ones)
    if (dto.answerImages !== undefined && Array.isArray(dto.answerImages)) {
      const newKeys = new Set(dto.answerImages.map((img: any) => img.r2Key));
      const oldImages = await this.prisma.answerImage.findMany({ where: { questionId: id }, select: { r2Key: true } });
      const keysToRemove = oldImages.filter(img => !newKeys.has(img.r2Key)).map(img => img.r2Key);

      await this.prisma.answerImage.deleteMany({ where: { questionId: id } });
      if (dto.answerImages.length > 0) {
        await this.prisma.answerImage.createMany({
          data: dto.answerImages.map((img: any, i: number) => ({
            questionId: id,
            url: img.url,
            r2Key: img.r2Key,
            orderIndex: img.orderIndex ?? i,
            caption: img.caption || null,
          })),
        });
      }
      for (const key of keysToRemove) {
        try { await this.uploads.deleteObject(key); } catch (e) { console.error('R2 cleanup fail', key, e); }
      }
    }

    return this.prisma.question.findUnique({
      where: { id },
      include: {
        localizations: true,
        questionImages: { orderBy: { orderIndex: 'asc' } },
        answerImages: { orderBy: { orderIndex: 'asc' } },
      },
    });
  }

  // ─── Admin: Get list of tournaments present in archive (for filter) ──
  async archiveTournaments() {
    const used = await this.prisma.tournamentQuestion.findMany({
      where: { isUsed: true },
      include: {
        tournament: { select: { id: true, title: true, endAt: true, startAt: true } },
      },
      distinct: ['tournamentId'],
      orderBy: { tournament: { startAt: 'desc' } },
    });
    return used.map(u => u.tournament).filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);
  }

  // ─── Admin: Get archive details for a question ────
  async archiveDetails(questionId: string) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { localizations: true },
    });
    if (!q) throw new NotFoundException('Вопрос не найден');

    // Find all played uses of this question (isUsed=true)
    const uses = await this.prisma.tournamentQuestion.findMany({
      where: { questionId, isUsed: true },
      include: {
        tournament: {
          select: { id: true, title: true, startAt: true, endAt: true, status: true },
        },
      },
      orderBy: { tournament: { startAt: 'desc' } },
    });

    // For each use, fetch answers via (tournamentId, questionId)
    const history = [] as any[];
    let totalAnswers = 0;
    let correctAnswers = 0;

    for (const u of uses) {
      const answers = (await this.prisma.answer.findMany({
        where: { tournamentId: u.tournamentId, questionId: u.questionId },
        include: {
          user: { select: { id: true, profile: { select: { nickname: true, countryCode: true } } } },
          judgement: true,
        },
        orderBy: { submittedAt: 'asc' },
      })) as any[];

      totalAnswers += answers.length;
      correctAnswers += answers.filter(a => a.judgement?.decision === 'ACCEPTED').length;

      const times = answers.map(a => new Date(a.submittedAt).getTime());
      const firstAnswerTime = times.length ? Math.min(...times) : null;

      history.push({
        tournamentQuestionId: u.id,
        tournament: u.tournament,
        noAnswers: answers.length === 0,
        answers: answers.map(a => {
          const at = new Date(a.submittedAt).getTime();
          const relSeconds = firstAnswerTime ? Math.round((at - firstAnswerTime) / 1000) : 0;
          return {
            id: a.id,
            nickname: a.user?.profile?.nickname || 'Аноним',
            flagCode: a.user?.profile?.countryCode || null,
            answerText: a.answerText,
            submittedAt: a.submittedAt,
            relSeconds,
            decision: a.judgement?.decision || null,
          };
        }),
      });
    }

    const successRate = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

    return {
      question: q,
      playedTimes: uses.length,
      totalAnswers,
      correctAnswers,
      successRate,
      history,
    };
  }

  // ─── Admin: Return archived question to library (delete all isUsed links) ──
  async returnToLibrary(questionId: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Вопрос не найден');
    // Only delete USED links — unused should not be here
    const result = await this.prisma.tournamentQuestion.deleteMany({
      where: { questionId, isUsed: true },
    });
    return { returned: true, removedLinks: result.count };
  }

  // ─── Admin: Remove question from tournament (returns to library) ──
  async removeFromTournament(tournamentQuestionId: string) {
    const tq = await this.prisma.tournamentQuestion.findUnique({
      where: { id: tournamentQuestionId },
      include: { tournament: true },
    });
    if (!tq) throw new NotFoundException('Связь вопроса с турниром не найдена');
    // Don't allow removal from LIVE or FINISHED tournament
    if (tq.tournament.status === 'LIVE') {
      throw new NotFoundException('Нельзя убрать вопрос из идущего турнира');
    }
    if (tq.isUsed) {
      throw new NotFoundException('Нельзя убрать сыгранный вопрос из турнира');
    }
    await this.prisma.tournamentQuestion.delete({ where: { id: tournamentQuestionId } });
    return { removed: true };
  }

  // ─── Admin: Reorder questions in tournament ─────
  async reorderInTournament(tournamentId: string, orderedTqIds: string[]) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true },
    });
    if (!tournament) throw new NotFoundException("Турнир не найден");
    if (tournament.status === "LIVE" || tournament.status === "FINISHED") {
      throw new NotFoundException("Нельзя менять порядок в идущем или завершённом турнире");
    }
    const existing = await this.prisma.tournamentQuestion.findMany({
      where: { tournamentId, isUsed: false },
      select: { id: true },
    });
    const existingIds = new Set(existing.map(e => e.id));
    for (const id of orderedTqIds) {
      if (!existingIds.has(id)) {
        throw new NotFoundException("Некоторые вопросы не относятся к этому турниру");
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const SAFE = 10000;
      for (let i = 0; i < orderedTqIds.length; i++) {
        await tx.tournamentQuestion.update({ where: { id: orderedTqIds[i] }, data: { orderIndex: SAFE + i } });
      }
      for (let i = 0; i < orderedTqIds.length; i++) {
        await tx.tournamentQuestion.update({ where: { id: orderedTqIds[i] }, data: { orderIndex: i } });
      }
    });
    return { reordered: true, count: orderedTqIds.length };
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

    // Collect R2 keys for cleanup (before DB cascade deletes images)
    const qImages = await this.prisma.questionImage.findMany({ where: { questionId: id }, select: { r2Key: true } });
    const aImages = await this.prisma.answerImage.findMany({ where: { questionId: id }, select: { r2Key: true } });
    const allKeys = [...qImages, ...aImages].map(i => i.r2Key).filter(Boolean);

    // Safe to delete: remove tournamentQuestion links first, then localizations, then question
    // (question_images and answer_images cascade automatically)
    await this.prisma.tournamentQuestion.deleteMany({ where: { questionId: id } });
    await this.prisma.questionLocalization.deleteMany({ where: { questionId: id } });
    await this.prisma.question.delete({ where: { id } });

    // Best-effort cleanup in R2 (don't block on errors)
    for (const key of allKeys) {
      try {
        await this.uploads.deleteObject(key);
      } catch (e) {
        console.error('Failed to delete R2 object', key, e);
      }
    }

    return { deleted: true, imagesRemoved: allKeys.length };
  }
}
