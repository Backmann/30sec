import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { VotesService } from './votes.service';
import { CastVoteDto } from './dto/cast-vote.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('votes')
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  // Public: vote results
  @Get('results/:tournamentId')
  getResults(@Param('tournamentId') tournamentId: string) {
    return this.votesService.getResults(tournamentId);
  }

  // Authorized: cast vote
  @UseGuards(JwtAuthGuard)
  @Post()
  castVote(@Body() dto: CastVoteDto, @Request() req) {
    return this.votesService.castVote(dto, req.user.sub);
  }

  // Authorized: check if already voted
  @UseGuards(JwtAuthGuard)
  @Get('my-vote/:tournamentId')
  hasVoted(@Param('tournamentId') tournamentId: string, @Request() req) {
    return this.votesService.hasVoted(tournamentId, req.user.sub);
  }
}
