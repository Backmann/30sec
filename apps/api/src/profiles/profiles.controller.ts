import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller()
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // ─── My profile (authorized) ──────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me/profile')
  getMyProfile(@Request() req) {
    return this.profilesService.getMyProfile(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/profile')
  updateMyProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.profilesService.updateMyProfile(req.user.sub, dto);
  }

  // ─── My stats ─────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  async getMyStats(@Request() req) {
    const profile = await this.profilesService.getMyProfile(req.user.sub);
    return { playerStats: profile.playerStats, spectatorStats: profile.spectatorStats };
  }

  // ─── My answer history ────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me/history/answers')
  getMyAnswerHistory(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.profilesService.getMyAnswerHistory(
      req.user.sub,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  // ─── My tournament history ────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('me/history/tournaments')
  getMyTournamentHistory(@Request() req) {
    return this.profilesService.getMyTournamentHistory(req.user.sub);
  }

  // ─── Public profile by nickname ───────────────
  @Get('players/:nickname')
  getPublicProfile(@Param('nickname') nickname: string) {
    return this.profilesService.getPublicProfile(nickname);
  }
}
