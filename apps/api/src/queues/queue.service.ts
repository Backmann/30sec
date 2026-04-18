import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailJobData } from './email.processor';
import { ReminderJobData } from './reminder.processor';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('reminder') private readonly reminderQueue: Queue,
  ) {}

  async queueEmail(data: EmailJobData) {
    return this.emailQueue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  // Schedule a reminder to be sent at a future time
  async scheduleTournamentReminder(tournamentId: string, startAt: Date) {
    const reminderTime = new Date(startAt.getTime() - 15 * 60 * 1000); // 15 min before
    const delay = reminderTime.getTime() - Date.now();

    // Skip if reminder time is in the past
    if (delay <= 0) {
      this.logger.log(`Tournament ${tournamentId} starts in less than 15 min, skipping reminder`);
      return null;
    }

    // Use deterministic job ID so re-scheduling (e.g. time changed) replaces old job
    const jobId = `reminder-${tournamentId}`;

    // Remove existing reminder if any (e.g. tournament time was updated)
    const existing = await this.reminderQueue.getJob(jobId);
    if (existing) {
      await existing.remove();
      this.logger.log(`Removed existing reminder for tournament ${tournamentId}`);
    }

    const job = await this.reminderQueue.add(
      'start-soon',
      { tournamentId, type: 'start-soon' } as ReminderJobData,
      {
        jobId,
        delay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(`Scheduled reminder for tournament ${tournamentId} in ${Math.round(delay / 60000)} min`);
    return job;
  }

  async cancelTournamentReminder(tournamentId: string) {
    const jobId = `reminder-${tournamentId}`;
    const existing = await this.reminderQueue.getJob(jobId);
    if (existing) {
      await existing.remove();
      this.logger.log(`Cancelled reminder for tournament ${tournamentId}`);
    }
  }
}
