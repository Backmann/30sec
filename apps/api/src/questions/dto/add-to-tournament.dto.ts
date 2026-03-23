import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class AddToTournamentDto {
  @IsString()
  tournamentId: string;

  @IsString()
  questionId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;
}
