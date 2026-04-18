import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailProcessor } from './email.processor';
import { ReminderProcessor } from './reminder.processor';
import { QueueService } from './queue.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'email' }, { name: 'reminder' }),
    MailModule,
    PrismaModule,
    NotificationsModule,
  ],
  providers: [EmailProcessor, ReminderProcessor, QueueService],
  exports: [QueueService],
})
export class QueueModule {}
