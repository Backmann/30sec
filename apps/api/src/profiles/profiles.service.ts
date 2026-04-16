import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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

    return this.prisma.profile.update({
      where: { userId },
      data: {
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        language: dto.language ?? undefined,
        countryCode: dto.countryCode ?? undefined,
        flagCode: dto.countryCode?.toLowerCase() ?? undefined,
        showRealName: dto.showRealName ?? undefined,
        phone: dto.phone ?? undefined,
      },
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

    const stats = profile.user.playerStats;

    return {
      nickname: profile.nickname,
      countryCode: profile.countryCode,
      flagCode: profile.flagCode,
      firstName: profile.showRealName ? profile.firstName : null,
      lastName: profile.showRealName ? profile.lastName : null,
      memberSince: profile.createdAt,
      stats: stats
        ? {
            totalAnswered: stats.totalAnswered,
            totalCorrect: stats.totalCorrect,
            accuracyPercent: stats.accuracyPercent,
            bestStreak: stats.bestStreak,
            weeklyFinals: stats.weeklyFinals,
            monthlyFinals: stats.monthlyFinals,
            seasonFinals: stats.seasonFinals,
            yearlyFinals: stats.yearlyFinals,
            wins12_0: stats.wins12_0,
            rank: stats.rank
              ? {
                  code: stats.rank.code,
                  title: stats.rank.title,
                  icon: stats.rank.icon,
                }
              : null,
          }
        : null,
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
  async deleteAccount(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error('Invalid password');
    await this.prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { userId },
        data: {
          nickname: `deleted_${userId.substring(0, 8)}`,
          firstName: 'Deleted',
          lastName: 'User',
          phone: null,
          countryCode: null,
          flagCode: null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted_${userId}@deleted.local`,
          passwordHash: '',
          isActive: false,
          deletedAt: new Date(),
        },
      });
    });
    return { success: true, message: 'Account successfully deleted. Your tournament history is anonymized but preserved for data integrity.' };
  }

}
