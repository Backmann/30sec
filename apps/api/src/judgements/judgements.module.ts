import { Module } from '@nestjs/common';
import { JudgementsController } from './judgements.controller';
import { JudgementsService } from './judgements.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queues/queue.module';

@Module({
  imports: [RealtimeModule, NotificationsModule, QueueModule],
  controllers: [JudgementsController],
  providers: [JudgementsService],
  exports: [JudgementsService],
})
export class JudgementsModule {}
