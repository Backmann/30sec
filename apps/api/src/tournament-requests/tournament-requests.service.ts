import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTournamentRequestDto,
  FulfillRequestsDto,
  SUPPORTED_LANGUAGES,
} from './tournament-requests.dto';

const ACTIVE = 'active';
const FULFILLED = 'fulfilled';
const WITHDRAWN = 'withdrawn';
const EXPIRED = 'expired';
const TTL_DAYS = 30;

// Public counters are bucketed to avoid showing tiny numbers (anti-shaming).
function toBucket(n: number): string | null {
  if (n < 5) return null;
  if (n < 10) return '5–10';
  if (n < 20) return '10–20';
  if (n < 50) return '20–50';
  return '50+';
}

@Injectable()
export class TournamentRequestsService {
  private readonly logger = new Logger(TournamentRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------- USER-FACING ----------

  /**
   * User signs up for a future tournament in given language.
   * One active request per user per language enforced at DB level (partial unique index).
   */
  async create(userId: string, dto: CreateTournamentRequestDto) {
    const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

    try {
      const created = await this.prisma.tournamentRequest.create({
        data: {
          userId,
          language: dto.language,
          preferredDays: dto.preferredDays ?? [],
          preferredTimeSlot: dto.preferredTimeSlot ?? null,
          themes: dto.themes ?? [],
          comment: dto.comment?.trim() || null,
          status: ACTIVE,
          expiresAt,
        },
      });
      this.logger.log(`Queue join: user=${userId} lang=${dto.language} id=${created.id}`);
      return created;
    } catch (err: any) {
      // Prisma unique violation code — caught from our partial unique index
      if (err?.code === 'P2002') {
        throw new ConflictException('Вы уже в очереди на этом языке');
      }
      throw err;
    }
  }

  /**
   * Withdraw own active request. Idempotent — repeated withdraw after success
   * still resolves with NotFound on next call (request no longer 'active').
   */
  async withdrawOwn(userId: string, id: string) {
    const existing = await this.prisma.tournamentRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Запись не найдена');
    if (existing.userId !== userId) throw new ForbiddenException('Это не ваша запись');
    if (existing.status !== ACTIVE) {
      throw new ConflictException('Запись уже неактивна');
    }

    await this.prisma.tournamentRequest.update({
      where: { id },
      data: { status: WITHDRAWN },
    });
    return { id, status: WITHDRAWN };
  }

  /**
   * Active queue rows for the current user, with cosmetics (counts in their queues).
   */
  async listMine(userId: string) {
    const rows = await this.prisma.tournamentRequest.findMany({
      where: { userId, status: ACTIVE },
      orderBy: { createdAt: 'desc' },
    });

    // Add total queue size per language so user sees "you and 7 others wait"
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const totalInLang = await this.prisma.tournamentRequest.count({
          where: { language: r.language, status: ACTIVE },
        });
        return { ...r, queueSize: totalInLang };
      }),
    );
    return enriched;
  }

  /**
   * Public stats — bucketed counts for landing page.
   * Returns nothing for languages with < 5 active requests (anti-shaming).
   */
  async publicStats() {
    const grouped = await this.prisma.tournamentRequest.groupBy({
      by: ['language'],
      where: { status: ACTIVE },
      _count: { _all: true },
    });

    const result: Record<string, { bucket: string }> = {};
    for (const g of grouped) {
      const bucket = toBucket(g._count._all);
      if (bucket) result[g.language] = { bucket };
    }
    return { byLanguage: result };
  }

  // ---------- ADMIN ----------

  /**
   * Admin overview: precise numbers, theme breakdown, day/time heatmap.
   */
  async adminOverview() {
    const active = await this.prisma.tournamentRequest.findMany({
      where: { status: ACTIVE },
      select: {
        language: true,
        preferredDays: true,
        preferredTimeSlot: true,
        themes: true,
      },
    });

    const byLanguage: Record<string, number> = {};
    const byDayLanguage: Record<string, Record<string, number>> = {};
    const byTimeSlotLanguage: Record<string, Record<string, number>> = {};
    const byThemeLanguage: Record<string, Record<string, number>> = {};

    for (const r of active) {
      byLanguage[r.language] = (byLanguage[r.language] ?? 0) + 1;

      if (!byDayLanguage[r.language]) byDayLanguage[r.language] = {};
      for (const d of r.preferredDays) {
        byDayLanguage[r.language][d] = (byDayLanguage[r.language][d] ?? 0) + 1;
      }

      if (r.preferredTimeSlot) {
        if (!byTimeSlotLanguage[r.language]) byTimeSlotLanguage[r.language] = {};
        byTimeSlotLanguage[r.language][r.preferredTimeSlot] =
          (byTimeSlotLanguage[r.language][r.preferredTimeSlot] ?? 0) + 1;
      }

      if (!byThemeLanguage[r.language]) byThemeLanguage[r.language] = {};
      for (const t of r.themes) {
        byThemeLanguage[r.language][t] = (byThemeLanguage[r.language][t] ?? 0) + 1;
      }
    }

    // Counts per status for the top widget
    const statusCounts = await this.prisma.tournamentRequest.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return {
      total: active.length,
      languages: SUPPORTED_LANGUAGES,
      byLanguage,
      byDayLanguage,
      byTimeSlotLanguage,
      byThemeLanguage,
      byStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    };
  }

  /**
   * Admin list with optional filters.
   */
  async adminList(params: { language?: string; status?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (params.language) where.language = params.language;
    if (params.status) where.status = params.status;

    const [items, total] = await Promise.all([
      this.prisma.tournamentRequest.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              profile: { select: { nickname: true, avatarUrl: true, timezone: true } },
            },
          },
          fulfilledByTournament: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(params.limit ?? 100, 200),
        skip: params.offset ?? 0,
      }),
      this.prisma.tournamentRequest.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Mark a batch of requests as fulfilled by a tournament.
   * Used when admin creates a tournament from queue: pass requestIds to "convert".
   */
  async fulfillRequests(dto: FulfillRequestsDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: dto.tournamentId },
      select: { id: true, title: true },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');

    const updated = await this.prisma.tournamentRequest.updateMany({
      where: {
        id: { in: dto.requestIds },
        status: ACTIVE,
      },
      data: {
        status: FULFILLED,
        fulfilledByTournamentId: dto.tournamentId,
      },
    });

    this.logger.log(
      `Fulfilled ${updated.count} requests via tournament ${dto.tournamentId}`,
    );
    return { fulfilled: updated.count, tournamentId: dto.tournamentId };
  }

  /**
   * Cron entrypoint — mark active requests past expires_at as expired.
   * Safe to call repeatedly; we only touch active ones.
   */
  async expireStale(): Promise<{ expired: number }> {
    const updated = await this.prisma.tournamentRequest.updateMany({
      where: {
        status: ACTIVE,
        expiresAt: { lt: new Date() },
      },
      data: { status: EXPIRED },
    });
    if (updated.count > 0) {
      this.logger.log(`Expired ${updated.count} stale requests`);
    }
    return { expired: updated.count };
  }
}
