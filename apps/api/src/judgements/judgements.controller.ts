import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JudgementsService } from './judgements.service';
import { JudgeAnswerDto } from './dto/judge-answer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('judgements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN', 'JUDGE')
export class JudgementsController {
  constructor(private readonly judgementsService: JudgementsService) {}

  @Post()
  judge(@Body() dto: JudgeAnswerDto, @Request() req) {
    return this.judgementsService.judge(dto, req.user.sub);
  }

  @Delete(':id/undo')
  undo(@Param('id') id: string) {
    return this.judgementsService.undoJudgement(id);
  }

  @Get('tournament/:tournamentId')
  getTournamentJudgements(@Param('tournamentId') tournamentId: string) {
    return this.judgementsService.getTournamentJudgements(tournamentId);
  }
}
