import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queues/queue.service';
import { JudgeAnswerDto } from './dto/judge-answer.dto';

@Injectable()
export class JudgementsService {
  private readonly MAX_SCORE = 12;
  private readonly MAX_QUESTIONS = 23;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly achievements: AchievementsService,
  ) {}

  // ─── Admin: Judge an answer ───────────────────
  async judge(dto: JudgeAnswerDto, judgeId: string) {
    // Find the answer
    const answer = await this.prisma.answer.findUnique({
      where: { id: dto.answerId },
      include: { judgement: true },
    });
    if (!answer) throw new NotFoundException('Ответ не найден');
    if (answer.judgement) throw new BadRequestException('Ответ уже оценён');

    // Create judgement
    const judgement = await this.prisma.judgement.create({
      data: {
        answerId: dto.answerId,
        judgeId,
        decision: dto.decision,
        reasonCode: dto.reasonCode || null,
        judgedAt: new Date(),
      },
    });

    // Update score
    const participant = await this.prisma.tournamentParticipant.findUnique({
      where: {
        userId_tournamentId: {
          userId: answer.userId,
          tournamentId: answer.tournamentId,
        },
      },
    });
    if (!participant) throw new NotFoundException('Участник не найден');

    let scoreUser = participant.currentScoreUser;
    let scoreSystem = participant.currentScoreSystem;

    if (dto.decision === 'ACCEPTED') {
      scoreUser += 1;
    } else {
      scoreSystem += 1;
    }

    // Update player stats
    await this.prisma.playerStat.updateMany({
      where: { userId: answer.userId },
      data: {
        totalAnswered: { increment: 1 },
        ...(dto.decision === 'ACCEPTED'
          ? { totalCorrect: { increment: 1 }, currentStreak: { increment: 1 } }
          : { totalWrong: { increment: 1 }, currentStreak: 0 }),
      },
    });

    // Update best streak if needed
    if (dto.decision === 'ACCEPTED') {
      const stats = await this.prisma.playerStat.findUnique({
        where: { userId: answer.userId },
      });
      if (stats && stats.currentStreak > stats.bestStreak) {
        await this.prisma.playerStat.update({
          where: { userId: answer.userId },
          data: { bestStreak: stats.currentStreak },
        });
      }
    }

    // Check match end (12 points or 23 questions)
    let matchStatus = participant.matchStatus;
    const totalQuestions = scoreUser + scoreSystem;

    if (scoreUser >= this.MAX_SCORE) {
      matchStatus = 'WON';
    } else if (scoreSystem >= this.MAX_SCORE) {
      matchStatus = 'LOST';
    } else if (totalQuestions >= this.MAX_QUESTIONS) {
      matchStatus = scoreUser > scoreSystem ? 'WON' : scoreUser < scoreSystem ? 'LOST' : 'FINISHED';
    }

    // Update participant
    const updatedParticipant = await this.prisma.tournamentParticipant.update({
      where: { id: participant.id },
      data: {
        currentScoreUser: scoreUser,
        currentScoreSystem: scoreSystem,
        matchStatus,
        ...(matchStatus === 'WON' || matchStatus === 'LOST' || matchStatus === 'FINISHED'
          ? { finishedAt: new Date() }
          : {}),
      },
    });

    // Update accuracy percent
    const stats = await this.prisma.playerStat.findUnique({
      where: { userId: answer.userId },
    });
    if (stats && stats.totalAnswered > 0) {
      const accuracy = (stats.totalCorrect / stats.totalAnswered) * 100;
      await this.prisma.playerStat.update({
        where: { userId: answer.userId },
        data: { accuracyPercent: Math.round(accuracy * 100) / 100 },
      });
    }

    // Record 12-0 wins/losses
    if (matchStatus === 'WON' && scoreSystem === 0) {
      await this.prisma.playerStat.updateMany({
        where: { userId: answer.userId },
        data: { wins12_0: { increment: 1 } },
      });
    }
    if (matchStatus === 'LOST' && scoreUser === 0) {
      await this.prisma.playerStat.updateMany({
        where: { userId: answer.userId },
        data: { losses0_12: { increment: 1 } },
      });
    }

    // Emit realtime judgement
    const questionLoc = await this.prisma.questionLocalization.findFirst({
      where: { questionId: answer.questionId },
    });
    await this.realtime.judgementReady(answer.tournamentId, {
      userId: answer.userId,
      answerId: answer.id,
      decision: dto.decision,
      correctAnswer: questionLoc?.correctAnswerLocalized || '',
      scoreUser,
      scoreSystem,
      matchStatus,
      questionId: answer.questionId,
    });

    // ─── Auto rank assignment ─────────────────────
    await this.updatePlayerRank(answer.userId);

    return {
      judgement,
      score: {
        user: scoreUser,
        system: scoreSystem,
        matchStatus,
      },
    };
  }

  // ─── Auto-assign rank based on correct answers ──
  private async updatePlayerRank(userId: string) {
    try {
      const stats = await this.prisma.playerStat.findUnique({
        where: { userId },
      });
      if (!stats) return;

      // Find the highest rank the player qualifies for
      const ranks = await this.prisma.rank.findMany({
        orderBy: { thresholdCorrectAnswers: 'desc' },
      });

      let newRankId: string | null = null;
      for (const rank of ranks) {
        if (stats.totalCorrect >= rank.thresholdCorrectAnswers) {
          newRankId = rank.id;
          break;
        }
      }

      // Update if rank changed
      if (newRankId && stats.rankId !== newRankId) {
        await this.prisma.playerStat.update({
          where: { userId },
          data: { rankId: newRankId },
        });
        console.log(`🏅 Rank updated for user ${userId} → ${newRankId}`);
      }
    } catch (err) {
      console.error('Rank update failed:', err.message);
    }
  }

  // ─── Recompute a player's stats from source data ──
  //
  // Instead of reversing increments one by one (which silently drifts as soon
  // as any path forgets a counter), we rebuild the whole PlayerStat row from
  // the judgements themselves. Every counted answer has a judgement — including
  // the auto-rejections created when a player runs out of time — so this is a
  // complete and exact reconstruction.
  //
  // Side effect worth knowing: this also repairs accuracyPercent after
  // auto-rejections, which never updated it.
  private async recalculatePlayerStats(userId: string) {
    const judgements = await this.prisma.judgement.findMany({
      where: { answer: { userId } },
      select: { decision: true, judgedAt: true },
      orderBy: { judgedAt: 'asc' },
    });

    const totalAnswered = judgements.length;
    const totalCorrect = judgements.filter(j => j.decision === 'ACCEPTED').length;
    const totalWrong = totalAnswered - totalCorrect;

    // Walk the timeline once to get both the trailing run and the best run.
    let currentStreak = 0;
    let bestStreak = 0;
    for (const j of judgements) {
      if (j.decision === 'ACCEPTED') {
        currentStreak += 1;
        if (currentStreak > bestStreak) bestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }

    // Clean-sheet results are derivable from the participant rows.
    const [wins12_0, losses0_12] = await Promise.all([
      this.prisma.tournamentParticipant.count({
        where: { userId, matchStatus: 'WON', currentScoreSystem: 0 },
      }),
      this.prisma.tournamentParticipant.count({
        where: { userId, matchStatus: 'LOST', currentScoreUser: 0 },
      }),
    ]);

    const accuracyPercent =
      totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 100 * 100) / 100
        : 0;

    await this.prisma.playerStat.updateMany({
      where: { userId },
      data: {
        totalAnswered,
        totalCorrect,
        totalWrong,
        currentStreak,
        bestStreak,
        accuracyPercent,
        wins12_0,
        losses0_12,
      },
    });

    // Rank follows totalCorrect, which may have gone down.
    await this.updatePlayerRank(userId);

    return { totalAnswered, totalCorrect, totalWrong, currentStreak, bestStreak, accuracyPercent };
  }

  // ─── Derive match status from the current score ──
  // Same rules as judge(), kept in one place so undo can't disagree with it.
  private deriveMatchStatus(scoreUser: number, scoreSystem: number): string {
    if (scoreUser >= this.MAX_SCORE) return 'WON';
    if (scoreSystem >= this.MAX_SCORE) return 'LOST';
    if (scoreUser + scoreSystem >= this.MAX_QUESTIONS) {
      if (scoreUser > scoreSystem) return 'WON';
      if (scoreUser < scoreSystem) return 'LOST';
      return 'FINISHED';
    }
    return 'PLAYING';
  }

  // ─── Admin: Undo a judgement ──────────────────
  async undoJudgement(judgementId: string) {
    const judgement = await this.prisma.judgement.findUnique({
      where: { id: judgementId },
      include: { answer: true },
    });
    if (!judgement) throw new NotFoundException('Judgement not found');

    const userId = judgement.answer.userId;
    const tournamentId = judgement.answer.tournamentId;

    const participant = await this.prisma.tournamentParticipant.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    // Reverse the score this judgement contributed.
    let scoreUser = participant.currentScoreUser;
    let scoreSystem = participant.currentScoreSystem;
    if (judgement.decision === 'ACCEPTED') {
      scoreUser = Math.max(0, scoreUser - 1);
    } else {
      scoreSystem = Math.max(0, scoreSystem - 1);
    }

    // The match may or may not still be over after the reversal — derive it
    // rather than assuming PLAYING, which used to resurrect finished matches.
    const matchStatus = this.deriveMatchStatus(scoreUser, scoreSystem);
    const isOver = matchStatus === 'WON' || matchStatus === 'LOST' || matchStatus === 'FINISHED';

    // Delete + score update must not half-apply.
    await this.prisma.$transaction([
      this.prisma.judgement.delete({ where: { id: judgementId } }),
      this.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: {
          currentScoreUser: scoreUser,
          currentScoreSystem: scoreSystem,
          matchStatus: matchStatus as any,
          finishedAt: isOver ? participant.finishedAt ?? new Date() : null,
        },
      }),
    ]);

    // Rebuild stats from what is left. Runs after the transaction so it sees
    // the deleted judgement and the corrected participant row.
    const stats = await this.recalculatePlayerStats(userId);

    // Emit updated score (admin only — UNDO bypasses player buffer)
    this.realtime.adminOnlyJudgement(tournamentId, {
      userId,
      answerId: judgement.answer.id,
      decision: 'UNDO',
      correctAnswer: '',
      scoreUser, scoreSystem,
      matchStatus,
    });

    return { undone: true, scoreUser, scoreSystem, matchStatus, stats };
  }

  // ─── Admin: Get all judgements for a tournament ──
  async getTournamentJudgements(tournamentId: string) {
    return this.prisma.judgement.findMany({
      where: { answer: { tournamentId } },
      include: {
        answer: {
          include: {
            user: {
              include: { profile: { select: { nickname: true } } },
            },
            question: {
              include: { localizations: true },
            },
          },
        },
      },
      orderBy: { judgedAt: 'desc' },
    });
  }
}
