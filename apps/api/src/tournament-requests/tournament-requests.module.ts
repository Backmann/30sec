import { Module } from '@nestjs/common';
import { TournamentRequestsService } from './tournament-requests.service';
import { TournamentRequestsController } from './tournament-requests.controller';

@Module({
  controllers: [TournamentRequestsController],
  providers: [TournamentRequestsService],
  exports: [TournamentRequestsService],
})
export class TournamentRequestsModule {}
