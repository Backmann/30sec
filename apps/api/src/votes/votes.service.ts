import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AchievementsService } from '../achievements/achievements.service';

@Injectable()
export class VotesService {
  // Voting window after tournament end (hours)
  private readonly VOTING_WINDOW_HOURS = 48;

  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
  ) {}

  // Cast or change vote
  async castVote(userId: string, tournamentId: string, questionId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, status: true, endAt: true },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');
    if (tournament.status !== 'FINISHED') {
      throw new BadRequestException('Голосование доступно только после завершения турнира');
    }
    if (tournament.endAt) {
      const hoursSinceEnd = (Date.now() - new Date(tournament.endAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceEnd > this.VOTING_WINDOW_HOURS) {
        throw new BadRequestException(`Голосование закрыто (прошло ${Math.floor(hoursSinceEnd)}ч)`);
      }
    }

    // Verify question was in this tournament and was played
    const tq = await this.prisma.tournamentQuestion.findFirst({
      where: { tournamentId, questionId, isUsed: true },
    });
    if (!tq) throw new BadRequestException('Этот вопрос не был сыгран в турнире');

    // Upsert
    const existing = await this.prisma.questionVote.findUnique({
      where: { tournamentId_voterUserId: { tournamentId, voterUserId: userId } },
    });
    if (existing) {
      if (existing.questionId === questionId) {
        // Same vote — toggle off (remove)
        await this.prisma.questionVote.delete({ where: { id: existing.id } });
        return { voted: false };
      }
      await this.prisma.questionVote.update({
        where: { id: existing.id },
        data: { questionId },
      });
    } else {
      await this.prisma.questionVote.create({
        data: { tournamentId, voterUserId: userId, questionId },
      });
    }
    this.achievements.onFirstVote(userId).catch(() => {});
    return { voted: true, questionId };
  }

  // Get aggregated results for a tournament
  async getResults(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { status: true, endAt: true, title: true },
    });
    if (!tournament) throw new NotFoundException('Турнир не найден');

    // All played questions with vote counts + creator info
    const tqs = await this.prisma.tournamentQuestion.findMany({
      where: { tournamentId, isUsed: true },
      include: {
        question: {
          include: {
            localizations: true,
            questionImages: { orderBy: { orderIndex: 'asc' } },
            creator: { include: { profile: { select: { nickname: true, flagCode: true } } } },
          },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    const votes = await this.prisma.questionVote.groupBy({
      by: ['questionId'],
      where: { tournamentId },
      _count: { questionId: true },
    });
    const voteMap = new Map<string, number>();
    for (const v of votes) voteMap.set(v.questionId, v._count.questionId);

    const totalVotes = Array.from(voteMap.values()).reduce((a, b) => a + b, 0);

    // Voting window state
    let votingOpen = false;
    let hoursLeft = 0;
    if (tournament.status === 'FINISHED' && tournament.endAt) {
      const hoursSinceEnd = (Date.now() - new Date(tournament.endAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceEnd < this.VOTING_WINDOW_HOURS) {
        votingOpen = true;
        hoursLeft = Math.ceil(this.VOTING_WINDOW_HOURS - hoursSinceEnd);
      }
    }

    const items = tqs.map((tq: any) => ({
      questionId: tq.questionId,
      orderIndex: tq.orderIndex,
      localizations: tq.question.localizations.map((l: any) => ({
        language: l.language,
        questionText: l.questionText,
        correctAnswer: l.correctAnswerLocalized,
      })),
      questionImages: tq.question.questionImages || [],
      creator: tq.question.creator
        ? { id: tq.question.creator.id, nickname: tq.question.creator.profile?.nickname, flagCode: tq.question.creator.profile?.flagCode }
        : null,
      votes: voteMap.get(tq.questionId) || 0,
    }));

    // Sort by votes desc
    items.sort((a: any, b: any) => b.votes - a.votes);

    // "Автор лучшего вопроса" — granted once voting has closed. Nothing fires
    // when the 48-hour window expires, since there is no scheduler, so the
    // results page doubles as the trigger: the first time anyone opens it
    // after the window shut, the winning authors get their badge. grant() is
    // idempotent, so every later visit does nothing.
    if (!votingOpen && tournament.status === 'FINISHED' && totalVotes > 0) {
      void this.awardBestQuestionAuthors(items).catch(() => {});
    }

    return {
      tournamentTitle: tournament.title,
      votingOpen,
      hoursLeft,
      totalVotes,
      items,
    };
  }

  /** Everyone tied at the top wins — a draw should not pick a favourite. */
  private async awardBestQuestionAuthors(items: any[]) {
    const topVotes = items[0]?.votes ?? 0;
    if (topVotes <= 0) return;
    const seen = new Set<string>();
    for (const item of items) {
      if (item.votes !== topVotes || !item.creator?.id) continue;
      if (seen.has(item.creator.id)) continue;
      seen.add(item.creator.id);
      await this.achievements.onBestQuestion(item.creator.id);
    }
  }

  // What did the user vote for
  async getMyVote(userId: string, tournamentId: string) {
    const v = await this.prisma.questionVote.findUnique({
      where: { tournamentId_voterUserId: { tournamentId, voterUserId: userId } },
    });
    return { questionId: v?.questionId || null };
  }
}
