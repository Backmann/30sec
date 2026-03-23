import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
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

  // ─── Public ───────────────────────────────────

  @Get()
  findAll(@Query('status') status?: string) {
    return this.tournamentsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findOne(id);
  }

  @Get(':id/leaderboard')
  leaderboard(@Param('id') id: string) {
    return this.tournamentsService.leaderboard(id);
  }

  // ─── Player ───────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  join(@Param('id') id: string, @Request() req) {
    return this.tournamentsService.join(id, req.user.sub);
  }

  // ─── Admin ────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post()
  create(@Body() dto: CreateTournamentDto, @Request() req) {
    return this.tournamentsService.create(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTournamentDto) {
    return this.tournamentsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.tournamentsService.start(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post(':id/finish')
  finish(@Param('id') id: string) {
    return this.tournamentsService.finish(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get(':id/current-question')
  getCurrentQuestion(@Param('id') id: string) {
    return this.tournamentsService.getCurrentQuestion(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('question/:tqId/mark-used')
  markQuestionUsed(@Param('tqId') tqId: string) {
    return this.tournamentsService.markQuestionUsed(tqId);
  }
}
