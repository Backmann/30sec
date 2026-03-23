import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuestionCategory } from '@prisma/client';

export class QuestionLocalizationDto {
  @IsString()
  language: string;

  @IsString()
  questionText: string;

  @IsString()
  correctAnswer: string;
}

export class CreateQuestionDto {
  @IsEnum(QuestionCategory, {
    message: 'Категория: LOGIC, LANGUAGE, DETECTIVE, HISTORY, SCIENCE, IMAGE',
  })
  category: QuestionCategory;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsBoolean()
  hasImage?: boolean;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Минимум 1 локализация' })
  @ValidateNested({ each: true })
  @Type(() => QuestionLocalizationDto)
  localizations: QuestionLocalizationDto[];
}
