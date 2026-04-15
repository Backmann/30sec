import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { JudgeAnswerDto } from './dto/judge-answer.dto';

@Injectable()
export class JudgementsService {
  private readonly MAX_SCORE = 12;
  private readonly MAX_QUESTIONS = 23;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
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
    this.realtime.judgementReady(answer.tournamentId, {
      userId: answer.userId,
      answerId: answer.id,
      decision: dto.decision,
      correctAnswer: questionLoc?.correctAnswerLocalized || '',
      scoreUser,
      scoreSystem,
      matchStatus,
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

  // ─── Admin: Undo a judgement ──────────────────
  async undoJudgement(judgementId: string) {
    const judgement = await this.prisma.judgement.findUnique({
      where: { id: judgementId },
      include: { answer: true },
    });
    if (!judgement) throw new NotFoundException('Judgement not found');

    const participant = await this.prisma.tournamentParticipant.findUnique({
      where: { userId_tournamentId: { userId: judgement.answer.userId, tournamentId: judgement.answer.tournamentId } },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    // Reverse score
    let scoreUser = participant.currentScoreUser;
    let scoreSystem = participant.currentScoreSystem;
    if (judgement.decision === 'ACCEPTED') { scoreUser = Math.max(0, scoreUser - 1); }
    else { scoreSystem = Math.max(0, scoreSystem - 1); }

    // Update participant score
    await this.prisma.tournamentParticipant.update({
      where: { id: participant.id },
      data: { currentScoreUser: scoreUser, currentScoreSystem: scoreSystem, matchStatus: 'PLAYING' },
    });

    // Reverse player stats
    await this.prisma.playerStat.updateMany({
      where: { userId: judgement.answer.userId },
      data: {
        totalAnswered: { decrement: 1 },
        ...(judgement.decision === 'ACCEPTED'
          ? { totalCorrect: { decrement: 1 } }
          : { totalWrong: { decrement: 1 } }),
      },
    });

    // Delete judgement
    await this.prisma.judgement.delete({ where: { id: judgementId } });

    // Emit updated score
    this.realtime.judgementReady(judgement.answer.tournamentId, {
      userId: judgement.answer.userId,
      answerId: judgement.answer.id,
      decision: 'UNDO',
      correctAnswer: '',
      scoreUser, scoreSystem,
      matchStatus: 'PLAYING',
    });

    return { undone: true, scoreUser, scoreSystem };
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
