import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import * as Sentry from '@sentry/node';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Внутренняя ошибка сервера';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object') {
        message = (exResponse as any).message || message;
        errors = (exResponse as any).errors || null;
      }
    } else if (exception instanceof Error) {
      console.error('Unhandled error:', exception.message, exception.stack);
    }

    // Report 5xx and non-HTTP errors to Sentry (skip 4xx user errors)
    if (status >= 500 || !(exception instanceof HttpException)) {
      Sentry.captureException(exception, {
        tags: { path: request?.url, method: request?.method, status },
        user: request?.user ? { id: request.user.sub, email: request.user.email } : undefined,
      });
    }

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(message) ? message : [message],
      errors,
      timestamp: new Date().toISOString(),
    });
  }
}
