import { IsString, IsOptional, IsBoolean, MaxLength, MinLength, Matches, IsDateString, IsIn, IsUrl } from 'class-validator';
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  // Must stay in sync with RegisterDto, which allows 3-30 characters and a
  // hyphen. While this rule was stricter, anyone who had registered with a
  // hyphen or a longer nickname was refused on every profile save, even when
  // they had not touched the nickname field at all.
  @MinLength(3, { message: 'Никнейм минимум 3 символа' })
  @MaxLength(30, { message: 'Никнейм максимум 30 символов' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Никнейм: только латиница, цифры, _ и -' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @IsBoolean()
  showRealName?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Некорректная дата рождения' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  @IsIn(['male', 'female', 'other', 'unspecified'], { message: 'Неверное значение пола' })
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  showCity?: boolean;

  @IsOptional()
  @IsBoolean()
  showAge?: boolean;

  @IsOptional()
  @IsBoolean()
  showCountry?: boolean;
}
