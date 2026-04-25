import { Body, Controller, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { VotesService } from './votes.service';
import { EmailVerifiedGuard } from '../common/guards/email-verified.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('votes')
export class VotesController {
  constructor(private readonly votes: VotesService) {}

  // Public: view results
  @Get('results/:tournamentId')
  getResults(@Param('tournamentId') tournamentId: string) {
    return this.votes.getResults(tournamentId);
  }

  // Authorized: cast or toggle vote
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @Post()
  cast(@Body() dto: { tournamentId: string; questionId: string }, @Request() req) {
    return this.votes.castVote(req.user.sub, dto.tournamentId, dto.questionId);
  }

  // Authorized: get my vote
  @UseGuards(JwtAuthGuard)
  @Get('my-vote/:tournamentId')
  myVote(@Param('tournamentId') tournamentId: string, @Request() req) {
    return this.votes.getMyVote(req.user.sub, tournamentId);
  }
}
