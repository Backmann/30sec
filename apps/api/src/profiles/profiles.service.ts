import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Get my full profile ──────────────────────
  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        playerStats: { include: { rank: true } },
        spectatorStats: true,
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      profile: user.profile,
      playerStats: user.playerStats
        ? {
            totalAnswered: user.playerStats.totalAnswered,
            totalCorrect: user.playerStats.totalCorrect,
            totalWrong: user.playerStats.totalWrong,
            accuracyPercent: user.playerStats.accuracyPercent,
            bestStreak: user.playerStats.bestStreak,
            currentStreak: user.playerStats.currentStreak,
            weeklyFinals: user.playerStats.weeklyFinals,
            monthlyFinals: user.playerStats.monthlyFinals,
            seasonFinals: user.playerStats.seasonFinals,
            yearlyFinals: user.playerStats.yearlyFinals,
            wins12_0: user.playerStats.wins12_0,
            losses0_12: user.playerStats.losses0_12,
            rank: user.playerStats.rank
              ? {
                  code: user.playerStats.rank.code,
                  title: user.playerStats.rank.title,
                  icon: user.playerStats.rank.icon,
                }
              : null,
          }
        : null,
      spectatorStats: user.spectatorStats,
    };
  }

  // ─── Update my profile ────────────────────────
  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Профиль не найден');

    const data: any = {
      firstName: dto.firstName ?? undefined,
      lastName: dto.lastName ?? undefined,
      language: dto.language ?? undefined,
      countryCode: dto.countryCode ?? undefined,
      flagCode: dto.countryCode?.toLowerCase() ?? undefined,
      showRealName: dto.showRealName ?? undefined,
      phone: dto.phone ?? undefined,
      avatarUrl: dto.avatarUrl ?? undefined,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      gender: dto.gender ?? undefined,
      city: dto.city ?? undefined,
      bio: dto.bio ?? undefined,
      timezone: dto.timezone ?? undefined,
      showCity: dto.showCity ?? undefined,
      showAge: dto.showAge ?? undefined,
      showCountry: dto.showCountry ?? undefined,
    };

    // Nickname change logic
    if (dto.nickname && dto.nickname !== profile.nickname) {
      // Check 30-day cooldown (skip if nickname was auto-generated, i.e. never changed)
      if (profile.nicknameChangedAt) {
        const daysSinceChange = (Date.now() - new Date(profile.nicknameChangedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceChange < 30) {
          const daysLeft = Math.ceil(30 - daysSinceChange);
          throw new BadRequestException(`Никнейм можно менять раз в 30 дней. Осталось ${daysLeft} дн.`);
        }
      }

      // Check uniqueness
      const existing = await this.prisma.profile.findUnique({
        where: { nickname: dto.nickname },
      });
      if (existing && existing.userId !== userId) {
        throw new BadRequestException('Этот никнейм уже занят');
      }

      data.nickname = dto.nickname;
      data.nicknameChangedAt = new Date();
    }

    return this.prisma.profile.update({
      where: { userId },
      data,
    });
  }

  // ─── My answer history ────────────────────────
  async getMyAnswerHistory(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [answers, total] = await Promise.all([
      this.prisma.answer.findMany({
        where: { userId },
        include: {
          judgement: true,
          question: {
            include: { localizations: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.answer.count({ where: { userId } }),
    ]);

    return {
      data: answers.map((a) => ({
        id: a.id,
        answerText: a.answerText,
        submittedAt: a.submittedAt,
        decision: a.judgement?.decision || null,
        question: {
          id: a.question.id,
          category: a.question.category,
          localizations: a.question.localizations.map((l) => ({
            language: l.language,
            questionText: l.questionText,
            correctAnswer: l.correctAnswerLocalized,
          })),
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── My tournament history ────────────────────
  async getMyTournamentHistory(userId: string) {
    return this.prisma.tournamentParticipant.findMany({
      where: { userId },
      include: {
        tournament: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            startAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
  }

  // ─── Public profile by nickname ───────────────
  async getPublicProfile(nickname: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { nickname },
      include: {
        user: {
          include: {
            playerStats: { include: { rank: true } },
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('Игрок не найден');
    if (!profile.user.isActive) throw new NotFoundException('Игрок не найден');
    if (profile.user.role !== 'USER' && profile.user.role !== 'ADMIN' && profile.user.role !== 'SUPERADMIN') {
      throw new NotFoundException('Игрок не найден');
    }

    const userId = profile.user.id;

    // Aggregated game stats
    const [wins, losses, finished, totalAnswers, correctAnswers] = await Promise.all([
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'WON' } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'LOST' } }),
      this.prisma.tournamentParticipant.count({ where: { userId, matchStatus: 'FINISHED' } }),
      this.prisma.answer.count({ where: { userId } }),
      this.prisma.answer.count({ where: { userId, judgement: { decision: 'ACCEPTED' } } }),
    ]);

    // Recent played tournaments
    const recent = await this.prisma.tournamentParticipant.findMany({
      where: { userId, matchStatus: { in: ['WON', 'LOST', 'FINISHED'] } },
      include: {
        tournament: { select: { id: true, title: true, endAt: true } },
      },
      orderBy: { joinedAt: 'desc' },
      take: 5,
    });

    const stats = profile.user.playerStats;
    const shouldShowName = profile.showRealName;

    // Next rank progress
    let rankProgress: { current: any; next: any; toNext: number; progressPct: number } | null = null;
    if (stats) {
      const allRanks = await this.prisma.rank.findMany({ orderBy: { thresholdCorrectAnswers: 'asc' } });
      const currentRank = stats.rank;
      const currentThreshold = currentRank?.thresholdCorrectAnswers || 0;
      const nextRank = allRanks.find((r: any) => r.thresholdCorrectAnswers > stats.totalCorrect) || null;
      if (nextRank) {
        const range = nextRank.thresholdCorrectAnswers - currentThreshold;
        const done = stats.totalCorrect - currentThreshold;
        rankProgress = {
          current: currentRank ? { code: currentRank.code, title: currentRank.title, icon: currentRank.icon } : null,
          next: { code: nextRank.code, title: nextRank.title, icon: nextRank.icon, threshold: nextRank.thresholdCorrectAnswers },
          toNext: nextRank.thresholdCorrectAnswers - stats.totalCorrect,
          progressPct: range > 0 ? Math.min(100, Math.round((done / range) * 100)) : 0,
        };
      } else {
        rankProgress = {
          current: currentRank ? { code: currentRank.code, title: currentRank.title, icon: currentRank.icon } : null,
          next: null,
          toNext: 0,
          progressPct: 100,
        };
      }
    }

    // Calculate age if date_of_birth set and show_age=true
    let age: number | null = null;
    if (profile.showAge && profile.dateOfBirth) {
      const dob = new Date(profile.dateOfBirth);
      const now = new Date();
      age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    }

    return {
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      city: profile.showCity ? profile.city : null,
      countryCode: profile.showCountry ? profile.countryCode : null,
      flagCode: profile.showCountry ? profile.flagCode : null,
      age,
      firstName: shouldShowName ? profile.firstName : null,
      lastName: shouldShowName ? profile.lastName : null,
      memberSince: profile.createdAt,
      rank: stats?.rank ? { code: stats.rank.code, title: stats.rank.title, icon: stats.rank.icon } : null,
      rankProgress,
      stats: {
        totalCorrect: stats?.totalCorrect || 0,
        wins, losses, finished,
        winRate: (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0,
        tournamentsPlayed: wins + losses + finished,
        answersTotal: totalAnswers,
        answersCorrect: correctAnswers,
        accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
        bestStreak: stats?.bestStreak || 0,
      },
      recentTournaments: recent.map((p: any) => ({
        id: p.tournament.id,
        title: p.tournament.title,
        endAt: p.tournament.endAt,
        scoreUser: p.currentScoreUser,
        scoreSystem: p.currentScoreSystem,
        matchStatus: p.matchStatus,
      })),
    };
  }
  // GDPR: Export all user data
  async exportUserData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        playerStats: true,
        spectatorStats: true,
        answers: { include: { judgement: true } },
        participations: { include: { tournament: { select: { title: true, type: true, status: true, startAt: true } } } },
        notifications: true,
        spectatorAnswers: true,
        questionReactions: true,
        questionVotes: true,
      },
    });
    if (!user) throw new Error('User not found');
    const { passwordHash, ...safe } = user as any;
    return {
      exportDate: new Date().toISOString(),
      userId,
      data: safe,
      _note: 'This is a complete export of your personal data from 30sec. Passwords are excluded for security.',
    };
  }

  // GDPR: Delete (anonymize) account
  //
  // Anonymizes the account instead of hard-deleting it: tournament results,
  // answers and judgements stay intact so other players' history and scores
  // remain consistent. Everything that identifies the person is removed.
  //
  // Password check uses argon2 — the same algorithm auth.service uses to hash.
  // (This used to call bcrypt.compare, which always returned false and made
  // account deletion impossible for every user.)
  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.deletedAt) throw new BadRequestException('Аккаунт уже удалён');

    // Google-only accounts have no password to verify against.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Этот аккаунт зарегистрирован через Google и не имеет пароля. ' +
        'Напишите нам через форму обратной связи, чтобы удалить его.',
      );
    }

    let valid = false;
    try {
      valid = await argon2.verify(user.passwordHash, password);
    } catch {
      valid = false;
    }
    if (!valid) throw new ForbiddenException('Неверный пароль');

    const stamp = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Profile: strip every identifying and optional personal field.
      await tx.profile.update({
        where: { userId },
        data: {
          nickname: `deleted_${userId.substring(0, 8)}`,
          firstName: 'Deleted',
          lastName: 'User',
          phone: null,
          phoneVerifiedAt: null,
          countryCode: null,
          flagCode: null,
          avatarUrl: null,
          bio: null,
          city: null,
          dateOfBirth: null,
          gender: null,
          timezone: null,
          showRealName: false,
          showCity: false,
          showAge: false,
          showCountry: false,
        },
      });

      // Sessions hold IP addresses, coordinates and device fingerprints —
      // personal data with no reason to survive deletion.
      await tx.userSession.deleteMany({ where: { userId } });

      // Notifications are personal messages; nothing depends on them.
      await tx.notification.deleteMany({ where: { userId } });

      // Feedback rows keep the text (useful to us) but lose the contact data.
      await tx.feedback.updateMany({
        where: { userId },
        data: { email: null, ipAddress: null, userAgent: null },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted_${userId}@deleted.local`,
          passwordHash: null,
          googleId: null,
          marketingConsent: false,
          isActive: false,
          deletedAt: stamp,
        },
      });
    });

    return {
      success: true,
      message:
        'Account successfully deleted. Your tournament history is anonymized but preserved for data integrity.',
    };
  }

  // ─── Activity heatmap + weekly stats ──────────
  async getActivityData(nickname: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { nickname },
      select: { userId: true },
    });
    if (!profile) throw new NotFoundException('Игрок не найден');
    const userId = profile.userId;

    // Last 365 days
    const since = new Date();
    since.setDate(since.getDate() - 365);

    // Answers per day
    const answers = await this.prisma.answer.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true, judgement: { select: { decision: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date (YYYY-MM-DD)
    const daily = new Map<string, { total: number; correct: number }>();
    for (const a of answers) {
      const day = a.createdAt.toISOString().split('T')[0];
      if (!daily.has(day)) daily.set(day, { total: 0, correct: 0 });
      const d = daily.get(day)!;
      d.total++;
      if (a.judgement?.decision === 'ACCEPTED') d.correct++;
    }

    // Build heatmap (365 days array)
    const heatmap: { date: string; total: number; correct: number }[] = [];
    for (let i = 0; i < 365; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      heatmap.push({ date: key, total: daily.get(key)?.total || 0, correct: daily.get(key)?.correct || 0 });
    }

    // Weekly rollup (last 12 weeks)
    const weekly: { weekStart: string; total: number; correct: number; accuracy: number }[] = [];
    const now = new Date();
    for (let w = 11; w >= 0; w--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - (w * 7 + 6));
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      let total = 0, correct = 0;
      for (const a of answers) {
        if (a.createdAt >= weekStart && a.createdAt < weekEnd) {
          total++;
          if (a.judgement?.decision === 'ACCEPTED') correct++;
        }
      }
      weekly.push({
        weekStart: weekStart.toISOString().split('T')[0],
        total, correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      });
    }

    return { heatmap, weekly };
  }
}
