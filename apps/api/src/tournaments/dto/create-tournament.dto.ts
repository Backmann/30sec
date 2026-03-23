import { IsString, IsOptional, IsEnum, IsInt, Min, IsDateString } from 'class-validator';
import { TournamentType } from '@prisma/client';

export class CreateTournamentDto {
  @IsString()
  title: string;

  @IsEnum(TournamentType, { message: 'Тип: WEEKLY, MONTHLY, SEASON, YEARLY' })
  type: TournamentType;

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
}
