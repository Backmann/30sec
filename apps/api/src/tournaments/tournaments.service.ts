import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

@Injectable()
export class TournamentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Admin: Create tournament ─────────────────
  async create(dto: CreateTournamentDto, adminId: string) {
    return this.prisma.tournament.create({
      data: {
        title: dto.title,
        type: dto.type,
        theme: dto.theme || null,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        maxPlayers: dto.maxPlayers || null,
        createdBy: adminId,
      },
    });
  }

  // ─── Admin: Update tournament ─────────────────
  async update(id: string, dto: UpdateTournamentDto) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED') {
      throw new BadRequestException('Нельзя редактировать завершённый турнир');
    }

    return this.prisma.tournament.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        theme: dto.theme ?? undefined,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        maxPlayers: dto.maxPlayers ?? undefined,
        status: dto.status ?? undefined,
      },
    });
  }

  // ─── Admin: Start tournament (DRAFT/SCHEDULED → LIVE) ──
  async start(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: { tournamentQuestions: true },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status === 'LIVE') throw new BadRequestException('Турнир уже идёт');
    if (tournament.status === 'FINISHED') throw new BadRequestException('Турнир уже завершён');
    if (tournament.tournamentQuestions.length === 0) {
      throw new BadRequestException('Добавьте вопросы перед запуском');
    }

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { status: 'LIVE', startAt: new Date() },
    });

    this.realtime.tournamentStarted(id, { title: updated.title, type: updated.type });
    return updated;
  }

  // ─── Admin: Finish tournament ─────────────────
  async finish(id: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id } });
    if (!tournament) throw new NotFoundException('Турнир не найден');

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { status: 'FINISHED', endAt: new Date() },
    });

    this.realtime.tournamentFinished(id);
    return updated;
  }

  // ─── Public: List tournaments ─────────────────
  async findAll(status?: string) {
    const where = status ? { status: status as any } : {};
    return this.prisma.tournament.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { participants: true } },
      },
    });
  }

  // ─── Public: Get tournament by ID ─────────────
  async findOne(id: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        participants: {
          include: {
            user: {
              include: { profile: { select: { nickname: true, flagCode: true } } },
            },
          },
          orderBy: { currentScoreUser: 'desc' },
        },
        tournamentQuestions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            question: {
              include: { localizations: true },
            },
          },
        },
        _count: { select: { participants: true } },
      },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    return tournament;
  }

  // ─── Player: Join tournament ──────────────────
  async join(tournamentId: string, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { _count: { select: { participants: true } } },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED') {
      throw new BadRequestException('Турнир завершён');
    }
    if (tournament.maxPlayers && tournament._count.participants >= tournament.maxPlayers) {
      throw new BadRequestException('Турнир заполнен');
    }

    // Check if already joined
    const existing = await this.prisma.tournamentParticipant.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (existing) throw new BadRequestException('Вы уже участвуете');

    return this.prisma.tournamentParticipant.create({
      data: { userId, tournamentId },
    });
  }

  // ─── Public: Leaderboard ──────────────────────
  async leaderboard(tournamentId: string) {
    return this.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: [
        { currentScoreUser: 'desc' },
        { currentScoreSystem: 'asc' },
      ],
      include: {
        user: {
          include: { profile: { select: { nickname: true, flagCode: true, countryCode: true } } },
        },
      },
    });
  }

  // ─── Admin: Get current question for tournament ──
  async getCurrentQuestion(tournamentId: string) {
    const nextQuestion = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId, isUsed: false },
      orderBy: { orderIndex: 'asc' },
      include: {
        question: {
          include: { localizations: true },
        },
      },
    });
    return nextQuestion;
  }

  // ─── Admin: Mark question as used ─────────────
  async markQuestionUsed(tournamentQuestionId: string) {
    return this.prisma.tournamentQuestion.update({
      where: { id: tournamentQuestionId },
      data: { isUsed: true },
    });
  }
}
