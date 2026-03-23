import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'Пароль минимум 8 символов' })
  @MaxLength(64)
  password: string;

  @IsString()
  @MinLength(1, { message: 'Введите имя' })
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MinLength(1, { message: 'Введите фамилию' })
  @MaxLength(50)
  lastName: string;

  @IsString()
  @MinLength(3, { message: 'Псевдоним минимум 3 символа' })
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Псевдоним: только латиница, цифры, _ и -',
  })
  nickname: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;
}
