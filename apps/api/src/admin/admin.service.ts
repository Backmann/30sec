import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Audit logs ───────────────────────────────
  async getAuditLogs(page: number = 1, limit: number = 50, actionType?: string) {
    const skip = (page - 1) * limit;
    const where = actionType ? { actionType } : {};

    const [logs, total] = await Promise.all([
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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
}
