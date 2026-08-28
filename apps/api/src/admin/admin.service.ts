import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerStatsService } from '../player-stats/player-stats.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playerStats: PlayerStatsService,
  ) {}

  // ─── Audit logs ───────────────────────────────
  async getAuditLogs(page: number = 1, limit: number = 50, actionType?: string) {
    const skip = (page - 1) * limit;
    const where = actionType ? { actionType } : {};

    const [logs, total] = await Promise.all([
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          admin: {
            include: {
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
      this.prisma.adminLog.count({ where }),
    ]);

    return {
      data: logs.map((log) => ({
        id: log.id,
        actionType: log.actionType,
        entityType: log.entityType,
        entityId: log.entityId,
        payload: log.payloadJson,
        adminNickname: log.admin.profile?.nickname || log.admin.email,
        createdAt: log.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Dashboard stats ──────────────────────────
  async getDashboardStats() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalTournaments,
      liveTournaments,
      totalQuestions,
      totalAnswers,
      totalJudgements,
      pendingApplications,
      newUsersToday,
      upcomingTournaments,
      liveTournamentsList,
      recentActivity,
    ] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.tournament.count(),
      this.prisma.tournament.count({ where: { status: 'LIVE' } }),
      this.prisma.question.count(),
      this.prisma.answer.count(),
      this.prisma.judgement.count(),
      this.prisma.tournamentParticipant.count({ where: { matchStatus: 'PENDING' } }),
      this.prisma.user.count({ where: { createdAt: { gte: oneDayAgo } } }),
      this.prisma.tournament.findMany({
        where: { status: { in: ['DRAFT', 'SCHEDULED'] }, startAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 5,
        include: {
          _count: { select: { tournamentQuestions: true, participants: true } },
        },
      }),
      this.prisma.tournament.findMany({
        where: { status: 'LIVE' },
        include: {
          _count: { select: { participants: true } },
        },
      }),
      this.prisma.adminLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          admin: { include: { profile: { select: { nickname: true } } } },
        },
      }),
    ]);

    return {
      totalUsers,
      totalTournaments,
      liveTournaments,
      totalQuestions,
      totalAnswers,
      totalJudgements,
      pendingApplications,
      newUsersToday,
      upcomingTournaments: upcomingTournaments.map(t => ({
        id: t.id,
        title: t.title,
        type: t.type,
        startAt: t.startAt,
        questionsCount: t._count.tournamentQuestions,
        questionsRequired: 23,
        participantsCount: t._count.participants,
        ready: t._count.tournamentQuestions >= 23,
      })),
      liveTournamentsList: liveTournamentsList.map(t => ({
        id: t.id,
        title: t.title,
        participantsCount: t._count.participants,
      })),
      recentActivity: recentActivity.map(log => ({
        id: log.id,
        actionType: log.actionType,
        entityType: log.entityType,
        adminNickname: log.admin.profile?.nickname || log.admin.email,
        createdAt: log.createdAt,
      })),
    };
  }

  // ─── List all users ───────────────────────────
  async listUsers(page: number = 1, limit: number = 50, role?: string) {
    const skip = (page - 1) * limit;
    const where = role ? { role: role as any } : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          profile: { select: { nickname: true, countryCode: true, language: true } },
          playerStats: { select: { totalAnswered: true, totalCorrect: true, accuracyPercent: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        emailVerifiedAt: u.emailVerifiedAt,
        nickname: u.profile?.nickname || null,
        countryCode: u.profile?.countryCode || null,
        stats: u.playerStats,
        createdAt: u.createdAt,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─── Toggle user active status ────────────────
  async toggleUserActive(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: { id: true, email: true, isActive: true },
    });
  }

  // ─── Change user role ─────────────────────────
  async changeUserRole(userId: string, role: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: role as any },
      select: { id: true, email: true, role: true },
    });
  }

  // ─── Admin: Full players list with rich stats ─────
  async getPlayers(opts: { search?: string; status?: 'active' | 'inactive' | 'cold' | 'all'; sort?: string } = {}) {
    const { search, status = 'all', sort = 'recent' } = opts;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const where: any = { role: { in: ['USER'] } };
    if (search && search.trim()) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { profile: { nickname: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        profile: true,
        sessions: { orderBy: { lastSeenAt: 'desc' }, take: 1 },
        _count: {
          select: {
            participations: true,
            sessions: true,
          },
        },
      },
    });

    // Enrich with game stats
    const enriched = await Promise.all(users.map(async (u) => {
      const [wins, losses, totalAnswers, correctAnswers] = await Promise.all([
        this.prisma.tournamentParticipant.count({ where: { userId: u.id, matchStatus: 'WON' } }),
        this.prisma.tournamentParticipant.count({ where: { userId: u.id, matchStatus: 'LOST' } }),
        this.prisma.answer.count({ where: { userId: u.id } }),
        this.prisma.answer.count({ where: { userId: u.id, judgement: { decision: 'ACCEPTED' } } }),
      ]);

      const lastSession = u.sessions[0];
      const lastSeenAt = lastSession?.lastSeenAt || u.createdAt;
      const daysSinceActive = Math.floor((now.getTime() - new Date(lastSeenAt).getTime()) / (24 * 3600 * 1000));
      const isCold = daysSinceActive >= 7;
      const isActive = daysSinceActive < 1;

      return {
        id: u.id,
        email: u.email,
        isActive: u.isActive,
        role: u.role,
        createdAt: u.createdAt,
        profile: u.profile,
        stats: {
          tournaments: u._count.participations,
          wins, losses,
          winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
          answersTotal: totalAnswers,
          answersCorrect: correctAnswers,
          accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
          sessionsCount: u._count.sessions,
        },
        activity: {
          lastSeenAt,
          daysSinceActive,
          isOnline: isActive,
          isCold,
          lastSession: lastSession ? {
            country: lastSession.countryCode,
            city: lastSession.city,
            deviceType: lastSession.deviceType,
            osName: lastSession.osName,
            browserName: lastSession.browserName,
            ipAddress: lastSession.ipAddress,
          } : null,
        },
      };
    }));

    // Filter by activity status
    let filtered = enriched;
    if (status === 'active') filtered = enriched.filter(u => u.activity.daysSinceActive < 7);
    else if (status === 'cold') filtered = enriched.filter(u => u.activity.isCold);
    else if (status === 'inactive') filtered = enriched.filter(u => !u.isActive);

    // Sort
    filtered.sort((a, b) => {
      if (sort === 'registered') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === 'accuracy') return b.stats.accuracy - a.stats.accuracy;
      if (sort === 'wins') return b.stats.wins - a.stats.wins;
      if (sort === 'tournaments') return b.stats.tournaments - a.stats.tournaments;
      // recent (default) — by last activity
      return new Date(b.activity.lastSeenAt).getTime() - new Date(a.activity.lastSeenAt).getTime();
    });

    return filtered;
  }

  // ─── Admin: Full player detail card ──────────────
  async getPlayerDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    // Recent sessions (last 20)
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      take: 20,
    });

    // Recent tournaments (last 10)
    const tournamentParticipations = await this.prisma.tournamentParticipant.findMany({
      where: { userId },
      include: {
        tournament: { select: { id: true, title: true, status: true, startAt: true, endAt: true } },
      },
      orderBy: { joinedAt: "desc" },
      take: 10,
    });

    // Game stats (aggregated)
    const [wins, losses, finished, totalAnswers, correctAnswers, totalApplications, approvedApps, rejectedApps] = await Promise.all([
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'WON' } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'LOST' } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'FINISHED' } }),
      this.prisma.answer.count({ where: { userId } }),
      this.prisma.answer.count({ where: { userId, judgement: { decision: 'ACCEPTED' } } }),
      this.prisma.tournamentParticipant.count({ where: { userId } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: { in: ['APPROVED', 'PLAYING', 'WON', 'LOST', 'FINISHED'] } } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'REJECTED' } }),
    ]);

    // Total time on site (sum of session durations)
    const totalSessionSeconds = await this.prisma.userSession.aggregate({
      where: { userId },
      _sum: { durationSeconds: true },
      _avg: { durationSeconds: true },
      _count: true,
    });

    // Country distribution (where has logged in from)
    const countrySessions = await this.prisma.userSession.groupBy({
      by: ['countryCode', 'city'],
      where: { userId, countryCode: { not: null } },
      _count: true,
    });

    // Notifications stats
    const [notifTotal, notifUnread] = await Promise.all([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        emailVerified: user.emailVerifiedAt != null,
        googleLinked: user.googleId != null,
      },
      profile: user.profile,
      stats: {
        wins, losses, finished,
        winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
        tournamentsTotal: totalApplications,
        applicationsApproved: approvedApps,
        applicationsRejected: rejectedApps,
        answersTotal: totalAnswers,
        answersCorrect: correctAnswers,
        accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
      },
      activity: {
        sessionsTotal: totalSessionSeconds._count || 0,
        totalMinutes: Math.round((totalSessionSeconds._sum?.durationSeconds || 0) / 60),
        avgSessionMinutes: Math.round((totalSessionSeconds._avg?.durationSeconds || 0) / 60),
        countries: countrySessions.map((c: any) => ({ country: c.countryCode, city: c.city, visits: c._count })),
      },
      notifications: { total: notifTotal, unread: notifUnread },
      recentSessions: sessions.map(s => ({
        id: s.id,
        ipAddress: s.ipAddress,
        deviceType: s.deviceType,
        osName: s.osName,
        browserName: s.browserName,
        countryCode: s.countryCode,
        city: s.city,
        region: s.region,
        timezone: s.timezone,
        startedAt: s.startedAt,
        lastSeenAt: s.lastSeenAt,
        durationMinutes: Math.round(s.durationSeconds / 60),
      })),
      recentTournaments: tournamentParticipations.map(p => ({
        tournamentId: (p as any).tournament.id,
        title: (p as any).tournament.title,
        status: (p as any).tournament.status,
        startAt: (p as any).tournament.startAt,
        matchStatus: p.matchStatus,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
      })),
    };
  }

  /**
   * Repair tool: rebuild every player's stats from the surviving judgements.
   * Needed once because deleted tournaments used to leave counters behind.
   */
  async recalculateAllStats() {
    return this.playerStats.recalculateAll();
  }
}

