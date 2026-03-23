import { IsString, IsEnum, IsOptional } from 'class-validator';
import { JudgementDecision } from '@prisma/client';

export class JudgeAnswerDto {
  @IsString()
  answerId: string;

  @IsEnum(JudgementDecision, { message: 'Решение: ACCEPTED или REJECTED' })
  decision: JudgementDecision;

  @IsOptional()
  @IsString()
  reasonCode?: string;
}
