import express from 'express';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
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
import { notificationsRouter } from './routes/notifications';
import { templatesRouter } from './routes/templates';
import { analyticsRouter } from './routes/analytics';
import { trackingRouter } from './routes/tracking';
import { getQueueStatus } from './services/queue';
import { imageKitOrigin } from './services/storage';
import { extractionLoad } from './services/extractionRunner';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  // Hops of reverse proxy in front of us (TRUST_PROXY, default 1). Must be right:
  // rate limits key on req.ip, which comes from X-Forwarded-For only when trusted.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(httpLogger);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Google Fonts stylesheet is linked from client/index.html.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          // blob: — screenshot previews use URL.createObjectURL before upload.
          // + ImageKit CDN: /jobs/:id/screenshot redirects there when enabled.
          imgSrc: ["'self'", 'data:', 'blob:', ...(imageKitOrigin() ? [imageKitOrigin()!] : [])],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
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
  // gzip JSON + the built client (~3–4× smaller over the wire). Tiny bodies
  // (tracking pixel, 204s) are skipped by the default 1 kB threshold.
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());

  // Liveness + DB readiness: 503 while MongoDB is disconnected, so the host's
  // health check restarts/pulls an instance that can't serve requests.
  app.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ ok: dbUp, service: 'jobmail-server', db: dbUp ? 'up' : 'down' });
  });

  app.get('/health/queue', (_req, res) => {
    const status = getQueueStatus();
    res.json({ ok: status.healthy, ...status, extraction: extractionLoad() });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/profile', profileRouter);
  app.use('/api/v1/jobs', jobsRouter);
  app.use('/api/v1/gmail', gmailRouter);
  app.use('/api/v1/applications', applicationsRouter);
  app.use('/api/v1/contacts', contactsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/templates', templatesRouter);
  app.use('/api/v1/analytics', analyticsRouter);
  // Tracking pixel: no auth, outside /api/v1 — loaded by mail clients (SPEC §5).
  app.use('/api/t', trackingRouter);

  // Production single-origin deploy: serve the built React app from this same
  // server so the SameSite=Strict auth cookies are always first-party. Enabled
  // automatically when client/dist exists (after `pnpm build`) outside tests;
  // CLIENT_DIST_DIR overrides the location.
  const clientDist = process.env.CLIENT_DIST_DIR
    ? path.resolve(process.env.CLIENT_DIST_DIR)
    : path.resolve(__dirname, '../../client/dist');
  if (env.NODE_ENV === 'production' && fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(
      express.static(clientDist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          // Hashed assets are immutable; everything else (media, fonts) revalidates.
          if (!filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      }),
    );
    // SPA fallback: any non-API GET renders index.html (React Router handles it).
    app.get(/^\/(?!api\/|health).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
