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
    } else if (isExposedClientError(exception)) {
      // Refused by express middleware before any route ran — body-parser's
      // 415 for an unknown encoding or charset, 413 for an oversized body.
      // These are http-errors objects, not HttpException, and used to fall
      // through to a 500 reported to Sentry (2 Nov 2026: a scanner's Brotli
      // body to POST /api/webhook). `expose` is http-errors' own flag that the
      // message was written for the client.
      status = exception.status;
      message = exception.message;
    } else if (exception instanceof Error) {
      console.error('Unhandled error:', exception.message, exception.stack);
    }

    // Report server failures only. A 4xx is the caller's mistake, whichever
    // layer refused it.
    if (status >= 500) {
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

/**
 * A client error raised outside Nest, in the http-errors shape that
 * body-parser and other express middleware use: a 4xx `status` and
 * `expose: true`. Requiring `expose` matters — an outgoing HTTP client hangs
 * the upstream's status on its own errors (an axios 404 has status 404 but no
 * expose), and that is our failure, to be answered as 500 and reported.
 */
function isExposedClientError(
  exception: unknown,
): exception is { status: number; message: string } {
  if (typeof exception !== 'object' || exception === null) return false;
  const e = exception as { status?: unknown; expose?: unknown; message?: unknown };
  return (
    e.expose === true &&
    typeof e.status === 'number' &&
    e.status >= 400 &&
    e.status < 500 &&
    typeof e.message === 'string'
  );
}
