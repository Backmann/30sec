import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AddToTournamentDto } from './dto/add-to-tournament.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post()
  create(@Body() dto: CreateQuestionDto, @Request() req) {
    return this.questionsService.create(dto, req.user.sub);
  }

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('onlyUnused') onlyUnused?: string,
    @Query('sort') sort?: 'new' | 'old',
    @Query('location') location?: 'library' | 'archive' | 'all',
    @Query('tournamentId') tournamentId?: string,
  ) {
    return this.questionsService.findAll({
      status,
      search,
      onlyUnused: onlyUnused === 'true',
      sort,
      location,
      tournamentId,
    });
  }

  @Get('archive/tournaments')
  archiveTournaments() {
    return this.questionsService.archiveTournaments();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  @Post('add-to-tournament')
  addToTournament(@Body() dto: AddToTournamentDto & { force?: boolean }) {
    return this.questionsService.addToTournament(dto);
  }

  @Post('auto-fill-tournament')
  @Roles('ADMIN', 'SUPERADMIN')
  autoFill(@Body() body: { tournamentId: string; count?: number }) {
    return this.questionsService.autoFillTournament(body.tournamentId, body.count || 23);
  }

  @Post('bulk-add-to-tournament')
  bulkAdd(@Body() body: { tournamentId: string; questionIds: string[] }) {
    return this.questionsService.bulkAddToTournament(body.tournamentId, body.questionIds);
  }

  @Get(':id/archive-details')
  archiveDetails(@Param('id') id: string) {
    return this.questionsService.archiveDetails(id);
  }

  @Post(':id/return-to-library')
  returnToLibrary(@Param('id') id: string) {
    return this.questionsService.returnToLibrary(id);
  }

  @Delete('tournament-question/:tqId')
  removeFromTournament(@Param('tqId') tqId: string) {
    return this.questionsService.removeFromTournament(tqId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.questionsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.questionsService.remove(id);
  }
}
