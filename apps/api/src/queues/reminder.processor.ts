import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from './queue.service';

export interface ReminderJobData {
  tournamentId: string;
  type: 'start-soon';
}

@Processor('reminder')
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<void> {
    this.logger.log(`Processing reminder job ${job.id}: ${job.data.type} for tournament ${job.data.tournamentId}`);

    try {
      if (job.data.type === 'start-soon') {
        await this.handleStartSoon(job.data.tournamentId);
      }
      this.logger.log(`Reminder job ${job.id} completed`);
    } catch (err) {
      this.logger.error(`Reminder job ${job.id} failed: ${err.message}`);
      throw err;
    }
  }

  private async handleStartSoon(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    // Tournament might be cancelled, deleted, or already started
    if (!tournament) {
      this.logger.log(`Tournament ${tournamentId} no longer exists, skipping reminder`);
      return;
    }
    if (tournament.status === 'LIVE' || tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED') {
      this.logger.log(`Tournament ${tournamentId} status is ${tournament.status}, skipping reminder`);
      return;
    }

    const participants = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId, matchStatus: 'APPROVED' },
      include: { user: { include: { profile: true } } },
    });

    const title = 'Турнир скоро начнётся! ⏰';
    const body = `Турнир "${tournament.title}" начинается через 15 минут. Приготовьтесь!`;

    for (const p of participants) {
      await this.notifications.create(p.userId, {
        type: 'TOURNAMENT_STARTING',
        title,
        body,
        channel: 'IN_APP',
      });

      await this.queue.queueEmail({
        type: 'notification',
        to: p.user.email,
        language: p.user.profile?.language || 'ru',
        data: { title, body },
      });
    }

    this.logger.log(`Reminder sent to ${participants.length} participants`);
  }
}
