import * as Sentry from '@sentry/node';

// Initialize Sentry BEFORE any other code
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.1,
  });
  console.log('✓ Sentry initialized');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix: /api
  app.setGlobalPrefix('api');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Audit log interceptor (auto-logs admin actions)
  const prisma = app.get(PrismaService);
  app.useGlobalInterceptors(new AuditLogInterceptor(prisma));

  // CORS
  app.enableCors({
    origin: process.env.APP_URL || '*',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 30sec. API running on port ${port}`);
  console.log(`🔒 Security: rate limiting, audit logs, exception filter active`);
}
bootstrap();
