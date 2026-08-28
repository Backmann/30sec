import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProxyThrottlerGuard } from './common/guards/proxy-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { PlayerStatsModule } from './player-stats/player-stats.module';
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
import { TrackingModule } from './tracking/tracking.module';
import { AchievementsModule } from './achievements/achievements.module';
import { FeedbackModule } from './feedback/feedback.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UploadsModule } from './uploads/uploads.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueModule } from './queues/queue.module';
import { TournamentRequestsModule } from './tournament-requests/tournament-requests.module';

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
    PlayerStatsModule,
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
    TrackingModule,
    AchievementsModule,
    FeedbackModule,
    HealthModule,
    AdminModule,
    UploadsModule,
    RealtimeModule,
    MailModule,
    NotificationsModule,
    QueueModule,
    TournamentRequestsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ProxyThrottlerGuard }],
})
export class AppModule {}
