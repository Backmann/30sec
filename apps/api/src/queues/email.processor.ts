import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';

export interface EmailJobData {
  type: 'verification' | 'notification';
  to: string;
  language?: string;
  data: any;
}

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mail: MailService) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    this.logger.log(`Processing email job ${job.id}: ${job.data.type} to ${job.data.to}`);

    try {
      switch (job.data.type) {
        case 'verification':
          await this.mail.sendVerificationCode(
            job.data.to,
            job.data.data.code,
            job.data.language || 'ru',
          );
          break;
        case 'notification':
          await this.mail.sendNotification(
            job.data.to,
            job.data.data.title,
            job.data.data.body,
            job.data.language || 'ru',
          );
          break;
        default:
          throw new Error(`Unknown email type: ${job.data.type}`);
      }
      this.logger.log(`Email job ${job.id} completed`);
    } catch (err) {
      this.logger.error(`Email job ${job.id} failed: ${err.message}`);
      throw err;
    }
  }
}
