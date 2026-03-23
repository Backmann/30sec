import {
  Controller,
  Get,
  Post,
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
  findAll(@Query('status') status?: string) {
    return this.questionsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  @Post('add-to-tournament')
  addToTournament(@Body() dto: AddToTournamentDto) {
    return this.questionsService.addToTournament(dto);
  }

  @Post('bulk-add-to-tournament')
  bulkAdd(@Body() body: { tournamentId: string; questionIds: string[] }) {
    return this.questionsService.bulkAddToTournament(body.tournamentId, body.questionIds);
  }
}
