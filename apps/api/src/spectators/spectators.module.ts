import { Module } from '@nestjs/common';
import { SpectatorsController } from './spectators.controller';
import { SpectatorsService } from './spectators.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [SpectatorsController],
  providers: [SpectatorsService],
  exports: [SpectatorsService],
})
export class SpectatorsModule {}
