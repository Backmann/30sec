import {
  IsString,
  IsOptional,
  IsArray,
  IsIn,
  ArrayMaxSize,
  ArrayUnique,
  MaxLength,
  Matches,
} from 'class-validator';

// Whitelist of supported languages (extend as you add UI translations).
export const SUPPORTED_LANGUAGES = ['ru', 'en', 'de', 'uk', 'fr', 'es', 'it', 'pl'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Whitelist of suggested themes (user-facing, simple strings).
export const SUPPORTED_THEMES = [
  'history',
  'science',
  'geography',
  'culture',
  'sports',
  'literature',
  'art',
  'music',
  'technology',
  'daily',
] as const;
export type SupportedTheme = (typeof SUPPORTED_THEMES)[number];

export const SUPPORTED_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type SupportedDay = (typeof SUPPORTED_DAYS)[number];

export const SUPPORTED_TIME_SLOTS = ['morning', 'afternoon', 'evening'] as const;
export type SupportedTimeSlot = (typeof SUPPORTED_TIME_SLOTS)[number];

export class CreateTournamentRequestDto {
  @IsString()
  @IsIn(SUPPORTED_LANGUAGES as unknown as string[], { message: 'Неподдерживаемый язык' })
  language: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7, { message: 'Слишком много дней' })
  @ArrayUnique()
  @IsIn(SUPPORTED_DAYS as unknown as string[], { each: true, message: 'Неверный день недели' })
  preferredDays?: string[];

  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_TIME_SLOTS as unknown as string[], { message: 'Неверное время суток' })
  preferredTimeSlot?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'Слишком много тем' })
  @ArrayUnique()
  @IsIn(SUPPORTED_THEMES as unknown as string[], { each: true, message: 'Неподдерживаемая тема' })
  themes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Комментарий: максимум 500 символов' })
  comment?: string;
}

export class AdminListQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,5}$/, { message: 'Неверный формат языка' })
  language?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'fulfilled', 'withdrawn', 'expired'], { message: 'Неверный статус' })
  status?: string;
}

export class FulfillRequestsDto {
  @IsString()
  tournamentId: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  requestIds: string[];
}
