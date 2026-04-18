import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Request() req, @Query('status') status?: string) { return this.tournamentsService.findAll(req.user.sub, status); }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) { return this.tournamentsService.findOne(id, req.user.sub); }

  @Get(':id/leaderboard')
  leaderboard(@Param('id') id: string) { return this.tournamentsService.leaderboard(id); }

  // Player: apply to join
  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  join(@Param('id') id: string, @Request() req) { return this.tournamentsService.join(id, req.user.sub); }

  // Admin: approve participant
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('participants/:participantId/approve')
  approve(@Param('participantId') pid: string) { return this.tournamentsService.approveParticipant(pid); }

  // Admin: reject participant
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('participants/:participantId/reject')
  reject(@Param('participantId') pid: string) { return this.tournamentsService.rejectParticipant(pid); }

  // Admin CRUD
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Post()
  create(@Body() dto: CreateTournamentDto, @Request() req) { return this.tournamentsService.create(dto, req.user.sub); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto) { return this.tournamentsService.update(id, dto); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/start')
  start(@Param('id') id: string) { return this.tournamentsService.start(id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/finish')
  finish(@Param('id') id: string) { return this.tournamentsService.finish(id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) { return this.tournamentsService.remove(id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Get(':id/current-question')
  getCurrentQuestion(@Param('id') id: string) { return this.tournamentsService.getCurrentQuestion(id); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/launch-question')
  launchQuestion(@Param('id') id: string) { return this.tournamentsService.launchNextQuestion(id); }

  @UseGuards(JwtAuthGuard)
  @Get(':id/game-state')
  getGameState(@Param('id') id: string, @Request() req) { return this.tournamentsService.getGameState(id, req.user.sub); }

  // Fill test questions
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/fill-test-questions')
  fillTestQuestions(@Param('id') id: string, @Request() req) { return this.tournamentsService.fillTestQuestions(id, req.user.sub); }
}
