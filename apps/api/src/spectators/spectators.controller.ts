import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SpectatorsService } from './spectators.service';
import { SaveSpectatorAnswerDto } from './dto/save-spectator-answer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('spectator')
export class SpectatorsController {
  constructor(private readonly spectatorsService: SpectatorsService) {}

  // Public: live tournament state
  @Get('live/:tournamentId')
  getLiveState(@Param('tournamentId') tournamentId: string) {
    return this.spectatorsService.getLiveState(tournamentId);
  }

  // Authorized: save personal answer
  @UseGuards(JwtAuthGuard)
  @Post('answer')
  saveAnswer(@Body() dto: SaveSpectatorAnswerDto, @Request() req) {
    return this.spectatorsService.saveAnswer(dto, req.user.sub);
  }

  // Authorized: my spectator answers for a tournament
  @UseGuards(JwtAuthGuard)
  @Get('my-answers/:tournamentId')
  getMyAnswers(@Param('tournamentId') tournamentId: string, @Request() req) {
    return this.spectatorsService.getMyAnswers(tournamentId, req.user.sub);
  }

  // Authorized: my spectator history
  @UseGuards(JwtAuthGuard)
  @Get('my-history')
  getMyHistory(@Request() req) {
    return this.spectatorsService.getMyHistory(req.user.sub);
  }
}
