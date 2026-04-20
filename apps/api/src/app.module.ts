import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { QuestionsModule } from './questions/questions.module';
import { AnswersModule } from './answers/answers.module';
import { JudgementsModule } from './judgements/judgements.module';
import { ProfilesModule } from './profiles/profiles.module';
import { RanksModule } from './ranks/ranks.module';
import { SpectatorsModule } from './spectators/spectators.module';
import { ReactionsModule } from './reactions/reactions.module';
import { VotesModule } from './votes/votes.module';
import { AdminModule } from './admin/admin.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UploadsModule } from './uploads/uploads.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queues/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: (config.get<number>('RATE_LIMIT_TTL') || 60) * 1000,
        limit: config.get<number>('RATE_LIMIT_LIMIT') || 60,
      }]),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    TournamentsModule,
    QuestionsModule,
    AnswersModule,
    JudgementsModule,
    ProfilesModule,
    RanksModule,
    SpectatorsModule,
    ReactionsModule,
    VotesModule,
    AdminModule,
    UploadsModule,
    RealtimeModule,
    MailModule,
    NotificationsModule,
    QueueModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
