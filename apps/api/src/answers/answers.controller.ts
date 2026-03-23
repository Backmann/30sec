import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AnswersService } from './answers.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('answers')
export class AnswersController {
  constructor(private readonly answersService: AnswersService) {}

  // Player: submit answer
  @UseGuards(JwtAuthGuard)
  @Post('submit')
  submit(@Body() dto: SubmitAnswerDto, @Request() req) {
    return this.answersService.submit(dto, req.user.sub);
  }

  // Player: my answers in tournament
  @UseGuards(JwtAuthGuard)
  @Get('my/:tournamentId')
  getMyAnswers(@Param('tournamentId') tournamentId: string, @Request() req) {
    return this.answersService.getMyAnswers(tournamentId, req.user.sub);
  }

  // Admin: answers for question in tournament
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'JUDGE')
  @Get('tournament/:tournamentId/question/:questionId')
  getAnswersForQuestion(
    @Param('tournamentId') tournamentId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.answersService.getAnswersForQuestion(tournamentId, questionId);
  }
}
