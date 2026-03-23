import { IsString } from 'class-validator';

export class CastVoteDto {
  @IsString()
  tournamentId: string;

  @IsString()
  questionId: string;
}
