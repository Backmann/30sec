import { Controller, Get, Query } from '@nestjs/common';
import { RanksService } from './ranks.service';

@Controller()
export class RanksController {
  constructor(private readonly ranksService: RanksService) {}

  @Get('ranks')
  findAll() {
    return this.ranksService.findAll();
  }

  @Get('leaderboard')
  globalLeaderboard(@Query('limit') limit?: string) {
    return this.ranksService.globalLeaderboard(limit ? parseInt(limit) : 50);
  }

  @Get('leaderboard/accuracy')
  accuracyLeaderboard(
    @Query('minAnswers') minAnswers?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ranksService.accuracyLeaderboard(
      minAnswers ? parseInt(minAnswers) : 10,
      limit ? parseInt(limit) : 50,
    );
  }
}
