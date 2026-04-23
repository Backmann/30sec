import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches, IsBoolean, Equals } from 'class-validator';
export class RegisterDto {
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Пароль минимум 8 символов' })
  @MaxLength(64)
  password: string;

  @IsString()
  @MinLength(3, { message: 'Псевдоним минимум 3 символа' })
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Псевдоним: только латиница, цифры, _ и -',
  })
  nickname: string;

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

  // GDPR — must be true
  @IsBoolean({ message: 'Примите условия использования' })
  @Equals(true, { message: 'Примите условия использования' })
  acceptTerms: boolean;

  @IsBoolean({ message: 'Примите политику конфиденциальности' })
  @Equals(true, { message: 'Примите политику конфиденциальности' })
  acceptPrivacy: boolean;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}
