import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReactionsService } from './reactions.service';
import { SetReactionDto } from './dto/set-reaction.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  // Public: available reaction types
  @Get('types')
  getReactionTypes() {
    return this.reactionsService.getReactionTypes();
  }

  // Public: reactions for a question
  @Get(':tournamentId/:questionId')
  getReactions(
    @Param('tournamentId') tournamentId: string,
    @Param('questionId') questionId: string,
  ) {
    return this.reactionsService.getReactions(tournamentId, questionId);
  }

  // Authorized: set or change reaction
  @UseGuards(JwtAuthGuard)
  @Post()
  setReaction(@Body() dto: SetReactionDto, @Request() req) {
    return this.reactionsService.setReaction(dto, req.user.sub);
  }

  // Authorized: remove reaction
  @UseGuards(JwtAuthGuard)
  @Delete(':tournamentId/:questionId')
  removeReaction(
    @Param('tournamentId') tournamentId: string,
    @Param('questionId') questionId: string,
    @Request() req,
  ) {
    return this.reactionsService.removeReaction(tournamentId, questionId, req.user.sub);
  }
}
