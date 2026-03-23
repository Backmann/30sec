import { IsString, MinLength, MaxLength } from 'class-validator';

export class SaveSpectatorAnswerDto {
  @IsString()
  tournamentId: string;

  @IsString()
  questionId: string;

  @IsString()
  @MinLength(1, { message: 'Введите ответ' })
  @MaxLength(100, { message: 'Максимум 100 символов' })
  answerText: string;
}
