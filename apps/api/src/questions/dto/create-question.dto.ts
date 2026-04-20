import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
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

export class QuestionImageDto {
  @IsString()
  url: string;
  @IsString()
  r2Key: string;
  @IsOptional()
  @IsInt()
  orderIndex?: number;
  @IsOptional()
  @IsString()
  caption?: string;
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Максимум 10 изображений к вопросу' })
  @ValidateNested({ each: true })
  @Type(() => QuestionImageDto)
  questionImages?: QuestionImageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Максимум 10 изображений к ответу' })
  @ValidateNested({ each: true })
  @Type(() => QuestionImageDto)
  answerImages?: QuestionImageDto[];
}
