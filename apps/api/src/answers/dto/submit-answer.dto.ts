import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitAnswerDto {
  @IsString()
  tournamentId: string;

  @IsString()
  questionId: string;

  @IsString()
  @MinLength(1, { message: 'Введите ответ' })
  @MaxLength(50, { message: 'Максимум 50 символов' })
  answerText: string;
}
