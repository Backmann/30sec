import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Only log for admin/judge/superadmin
    if (!user || !['ADMIN', 'JUDGE', 'SUPERADMIN'].includes(user.role)) {
      return next.handle();
    }

    const method = request.method;
    const url = request.url;
    const body = request.body;

    // Only log write operations
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async (responseData) => {
        try {
          // Determine action and entity from URL
          const urlParts = url.replace('/api/', '').split('/');
          const entityType = urlParts[0] || 'unknown';
          const entityId = responseData?.id || urlParts[1] || null;

          let actionType = `${method.toLowerCase()}_${entityType}`;

          // Special cases
          if (url.includes('/start')) actionType = 'start_tournament';
          if (url.includes('/finish')) actionType = 'finish_tournament';
          if (url.includes('/mark-used')) actionType = 'mark_question_used';
          if (url.includes('/judgements')) actionType = 'judge_answer';

          await this.prisma.adminLog.create({
            data: {
              adminUserId: user.sub,
              actionType,
              entityType,
              entityId: entityId ? String(entityId) : null,
              payloadJson: body && Object.keys(body).length > 0 ? body : null,
            },
          });
        } catch (err) {
          // Don't fail the request if logging fails
          console.error('Audit log error:', err.message);
        }
      }),
    );
  }
}
