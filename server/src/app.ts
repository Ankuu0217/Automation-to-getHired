import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { env } from './config/env';
import { httpLogger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth';
import { profileRouter } from './routes/profile';
import { jobsRouter } from './routes/jobs';
import { gmailRouter } from './routes/gmail';
import { applicationsRouter } from './routes/applications';
import { contactsRouter } from './routes/contacts';
import { templatesRouter } from './routes/templates';
import { analyticsRouter } from './routes/analytics';
import { trackingRouter } from './routes/tracking';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'jobmail-server' });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/profile', profileRouter);
  app.use('/api/v1/jobs', jobsRouter);
  app.use('/api/v1/gmail', gmailRouter);
  app.use('/api/v1/applications', applicationsRouter);
  app.use('/api/v1/contacts', contactsRouter);
  app.use('/api/v1/templates', templatesRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  // Tracking pixel: no auth, outside /api/v1 — loaded by mail clients (SPEC §5).
  app.use('/api/t', trackingRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
