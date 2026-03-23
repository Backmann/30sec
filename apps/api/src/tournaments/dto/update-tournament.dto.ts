import { IsString, IsOptional, IsEnum, IsInt, Min, IsDateString } from 'class-validator';
import { TournamentStatus } from '@prisma/client';

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  maxPlayers?: number;

  @IsOptional()
  @IsEnum(TournamentStatus)
  status?: TournamentStatus;
}
