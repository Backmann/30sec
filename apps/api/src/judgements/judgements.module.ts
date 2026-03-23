import { Module } from '@nestjs/common';
import { JudgementsController } from './judgements.controller';
import { JudgementsService } from './judgements.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [JudgementsController],
  providers: [JudgementsService],
  exports: [JudgementsService],
})
export class JudgementsModule {}
