import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard but does not fail when there is no token.
 * Allows authenticated context (req.user) when token present, otherwise leaves req.user undefined.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(_err: any, user: any): TUser {
    // If user not authenticated (no token / invalid), return null instead of throwing
    return (user as TUser) || (null as any);
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
