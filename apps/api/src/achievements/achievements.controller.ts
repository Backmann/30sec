import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AchievementsService } from './achievements.service';

@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  myList(@Request() req) {
    return this.achievements.listForUser(req.user.sub);
  }

  @Get('player/:nickname')
  publicList(@Param('nickname') nickname: string) {
    return this.achievements.listUnlockedByNickname(nickname);
  }
}
