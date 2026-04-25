import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Blocks unverified-email users from sensitive actions.
 * Must be combined with @UseGuards(JwtAuthGuard) — relies on req.user.sub.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('Не авторизован');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    if (!user?.emailVerifiedAt) {
      throw new ForbiddenException('Подтвердите email чтобы выполнить это действие');
    }
    return true;
  }
}
