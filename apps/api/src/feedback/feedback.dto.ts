import { IsString, IsOptional, IsIn, MaxLength, MinLength, IsEmail } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @IsIn(['bug', 'suggestion', 'question', 'other'], { message: 'Неверная категория' })
  category: string;

  @IsString()
  @MinLength(3, { message: 'Тема: минимум 3 символа' })
  @MaxLength(120, { message: 'Тема: максимум 120 символов' })
  subject: string;

  @IsString()
  @MinLength(10, { message: 'Сообщение: минимум 10 символов' })
  @MaxLength(3000, { message: 'Сообщение: максимум 3000 символов' })
  message: string;

  @IsOptional()
  @IsEmail({}, { message: 'Некорректный email' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

export class UpdateFeedbackDto {
  @IsOptional()
  @IsString()
  @IsIn(['new', 'reviewed', 'resolved', 'wontfix'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNotes?: string;
}
