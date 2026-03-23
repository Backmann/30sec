import { IsString } from 'class-validator';

export class SetReactionDto {
  @IsString()
  tournamentId: string;

  @IsString()
  questionId: string;

  @IsString()
  reactionCode: string;
}
