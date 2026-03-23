import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

// Store verification codes in memory (Redis in production later)
const verificationCodes = new Map<string, { code: string; expiresAt: Date }>();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    // Check email uniqueness
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existingEmail) {
      throw new ConflictException('Email уже зарегистрирован');
    }

    // Check nickname uniqueness
    const existingNickname = await this.prisma.profile.findUnique({
      where: { nickname: dto.nickname },
    });
    if (existingNickname) {
      throw new ConflictException('Псевдоним уже занят');
    }

    // Hash password
    const passwordHash = await argon2.hash(dto.password);

    // Create user + profile + playerStats in transaction
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        profile: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            nickname: dto.nickname,
            language: dto.language || 'ru',
            countryCode: dto.countryCode || null,
            flagCode: dto.countryCode?.toLowerCase() || null,
          },
        },
        playerStats: {
          create: {},
        },
      },
      include: {
        profile: true,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    // Send verification code
    await this.sendVerificationCode(user.email, dto.language || 'ru');

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: false,
        profile: {
          nickname: user.profile.nickname,
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          language: user.profile.language,
          countryCode: user.profile.countryCode,
        },
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { profile: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile
          ? {
              nickname: user.profile.nickname,
              firstName: user.profile.firstName,
              lastName: user.profile.lastName,
              language: user.profile.language,
              countryCode: user.profile.countryCode,
            }
          : null,
      },
      ...tokens,
    };
  }

  async refresh(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    return tokens;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        playerStats: {
          include: { rank: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      profile: user.profile
        ? {
            nickname: user.profile.nickname,
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            language: user.profile.language,
            countryCode: user.profile.countryCode,
            flagCode: user.profile.flagCode,
            showRealName: user.profile.showRealName,
          }
        : null,
      stats: user.playerStats
        ? {
            totalAnswered: user.playerStats.totalAnswered,
            totalCorrect: user.playerStats.totalCorrect,
            accuracyPercent: user.playerStats.accuracyPercent,
            bestStreak: user.playerStats.bestStreak,
            currentStreak: user.playerStats.currentStreak,
            rank: user.playerStats.rank
              ? {
                  code: user.playerStats.rank.code,
                  title: user.playerStats.rank.title,
                  icon: user.playerStats.rank.icon,
                }
              : null,
          }
        : null,
    };
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  // ─── Email Verification ─────────────────────
  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendVerificationCode(email: string, language: string = 'ru') {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    verificationCodes.set(email.toLowerCase(), { code, expiresAt });
    await this.mail.sendVerificationCode(email, code, language);

    return { message: 'Verification code sent' };
  }

  async verifyEmail(email: string, code: string) {
    const stored = verificationCodes.get(email.toLowerCase());

    if (!stored) {
      throw new BadRequestException('Код не найден. Запросите новый.');
    }

    if (new Date() > stored.expiresAt) {
      verificationCodes.delete(email.toLowerCase());
      throw new BadRequestException('Код истёк. Запросите новый.');
    }

    if (stored.code !== code) {
      throw new BadRequestException('Неверный код');
    }

    // Mark email as verified
    await this.prisma.user.update({
      where: { email: email.toLowerCase() },
      data: { emailVerifiedAt: new Date() },
    });

    verificationCodes.delete(email.toLowerCase());
    return { message: 'Email verified', verified: true };
  }

  async resendVerificationCode(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.emailVerifiedAt) throw new BadRequestException('Email already verified');

    const language = user.profile?.language || 'ru';
    return this.sendVerificationCode(user.email, language);
  }
}
