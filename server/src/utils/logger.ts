import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from '../config/env';

/**
 * Redact anything that could leak credentials or user content.
 * Never log email bodies, tokens, cookies, or passwords (spec §8).
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.bodyText',
  'req.body.bodyHtml',
  'req.body.emailContent',
  // OAuth authorization codes are single-use credentials — never log them.
  'req.query.code',
  'req.query.state',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
];

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  // Don't log health-check noise; keep everything else at info.
  autoLogging: { ignore: (req) => req.url === '/health' },
});
