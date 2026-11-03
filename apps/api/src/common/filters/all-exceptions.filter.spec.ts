import 'reflect-metadata';
import * as http from 'http';
import * as zlib from 'zlib';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));
import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * The filter decides two things for every failed request: which status the
 * client sees, and whether Sentry hears about it.
 *
 * On 2 Nov 2026 a scanner sent a Brotli-compressed body to POST /api/webhook.
 * body-parser refused it with a proper 415 before any route ran, but the
 * filter only recognised Nest's own HttpException, so it answered 500 and
 * reported the scanner to Sentry as a server failure. Every malformed JSON
 * body and every oversized one took the same path.
 *
 * These tests run a real Nest application with the real body-parser, so the
 * errors under test are the ones production actually produces — not copies of
 * their shape written by hand.
 */

@Controller('t')
class ProbeController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return body;
  }

  @Get('boom')
  boom() {
    throw new Error('database exploded: password=hunter2');
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException('nope');
  }

  // An outgoing HTTP client (axios, fetch wrappers) hangs the UPSTREAM status
  // on its error. That is our failure, not the caller's mistake, and must not
  // be passed off as a 404 to the client or hidden from Sentry.
  @Get('upstream-404')
  upstream() {
    const err: any = new Error('Request failed with status code 404');
    err.status = 404;
    throw err;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

type Reply = { status: number; body: any };

function send(
  port: number,
  method: string,
  path: string,
  body?: Buffer,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: body ? { 'Content-Length': String(body.length), ...headers } : headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            /* keep raw text */
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const json = { 'Content-Type': 'application/json' };

describe('AllExceptionsFilter', () => {
  let app: INestApplication;
  let port: number;
  const captured = Sentry.captureException as jest.Mock;

  beforeAll(async () => {
    app = await NestFactory.create(ProbeModule, { logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as any).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    captured.mockClear();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('requests the body parser refuses are the caller’s mistake', () => {
    it('a Brotli body gets 415 and stays out of Sentry (the 2 Nov alert)', async () => {
      const body = zlib.brotliCompressSync(Buffer.from('{"a":1}'));
      const res = await send(port, 'POST', '/api/webhook', body, {
        ...json,
        'Content-Encoding': 'br',
      });
      expect(res.status).toBe(415);
      expect(res.body.message).toEqual(['unsupported content encoding "br"']);
      expect(captured).not.toHaveBeenCalled();
    });

    it('malformed JSON gets 400 and stays out of Sentry', async () => {
      const res = await send(port, 'POST', '/api/t/echo', Buffer.from('{"a":'), json);
      expect(res.status).toBe(400);
      expect(captured).not.toHaveBeenCalled();
    });

    it('a body over the parser limit gets 413 and stays out of Sentry', async () => {
      const big = Buffer.from(JSON.stringify({ s: 'x'.repeat(200 * 1024) }));
      const res = await send(port, 'POST', '/api/t/echo', big, json);
      expect(res.status).toBe(413);
      expect(captured).not.toHaveBeenCalled();
    });

    it('an unknown charset gets 415 and stays out of Sentry', async () => {
      const res = await send(port, 'POST', '/api/t/echo', Buffer.from('{}'), {
        'Content-Type': 'application/json; charset=klingon',
      });
      expect(res.status).toBe(415);
      expect(captured).not.toHaveBeenCalled();
    });
  });

  describe('what already worked keeps working', () => {
    it('a gzip body the parser can read still reaches the route', async () => {
      const body = zlib.gzipSync(Buffer.from('{"a":1}'));
      const res = await send(port, 'POST', '/api/t/echo', body, {
        ...json,
        'Content-Encoding': 'gzip',
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ a: 1 });
    });

    it('an unknown route is a quiet 404', async () => {
      const res = await send(port, 'GET', '/api/no-such-route');
      expect(res.status).toBe(404);
      expect(captured).not.toHaveBeenCalled();
    });

    it('a Nest HttpException keeps its status and stays out of Sentry', async () => {
      const res = await send(port, 'GET', '/api/t/forbidden');
      expect(res.status).toBe(403);
      expect(res.body.message).toEqual(['nope']);
      expect(captured).not.toHaveBeenCalled();
    });
  });

  describe('real failures are still reported', () => {
    it('a thrown Error is a 500, reported once, and its text is not shown', async () => {
      const res = await send(port, 'GET', '/api/t/boom');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
      expect(captured).toHaveBeenCalledTimes(1);
    });

    it('an error carrying an upstream status is still our 500, and reported', async () => {
      const res = await send(port, 'GET', '/api/t/upstream-404');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('Request failed');
      expect(captured).toHaveBeenCalledTimes(1);
    });
  });
});
