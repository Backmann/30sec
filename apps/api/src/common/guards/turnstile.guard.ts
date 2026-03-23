import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';

@Injectable()
export class TurnstileGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secretKey = this.config.get<string>('TURNSTILE_SECRET_KEY');

    // Skip verification if no secret key configured (development)
    if (!secretKey || secretKey === 'change_me_later') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = request.body?.turnstileToken || request.headers['x-turnstile-token'];

    if (!token) {
      throw new BadRequestException('CAPTCHA token обязателен');
    }

    const isValid = await this.verifyToken(token, secretKey);
    if (!isValid) {
      throw new BadRequestException('CAPTCHA верификация не пройдена');
    }

    return true;
  }

  private verifyToken(token: string, secret: string): Promise<boolean> {
    return new Promise((resolve) => {
      const data = JSON.stringify({
        secret,
        response: token,
      });

      const options = {
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v0/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const result = JSON.parse(body);
            resolve(result.success === true);
          } catch {
            resolve(false);
          }
        });
      });

      req.on('error', () => resolve(false));
      req.write(data);
      req.end();
    });
  }
}
