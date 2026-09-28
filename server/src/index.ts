import mongoose from 'mongoose';
import { createApp } from './app';
import { env } from './config/env';
import { initQueue, stopQueue } from './services/queue';
import { logger } from './utils/logger';
import { terminateOcr } from './services/ai/ocr';
import { startMaintenance, stopMaintenance } from './services/maintenance';

async function main(): Promise<void> {
  const app = createApp();

  // Start listening immediately so the client gets a clear connection error
  // instead of a hang when Mongo isn't up yet.
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on ${env.API_URL} (env: ${env.NODE_ENV})`);
  });

  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    logger.info('Connected to MongoDB');
    await initQueue();
    startMaintenance();
  } catch (err) {
    if (env.NODE_ENV === 'production') {
      // In production a server without a DB (and without the send queue) is
      // worse than no server: exit so the host restarts us and health checks fail loudly.
      logger.fatal({ err }, 'MongoDB connection failed — exiting so the platform can restart the service.');
      process.exit(1);
    }
    logger.error(
      { err },
      'MongoDB connection failed — start it with `docker compose up -d`. The server keeps running and will report DB errors per request.',
    );
  }

  warnOnRiskyProductionConfig();

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close();
    stopMaintenance();
    await stopQueue().catch(() => undefined);
    await terminateOcr().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Loud boot-time warnings for production misconfigurations that don't crash but silently break features. */
function warnOnRiskyProductionConfig(): void {
  if (env.NODE_ENV !== 'production') return;
  if (!env.COOKIE_SECURE) {
    logger.warn('COOKIE_SECURE=false in production — set it to true when serving over HTTPS.');
  }
  if (!env.SMTP_HOST && !(env.GMAIL_USER && env.GMAIL_APP_PASSWORD)) {
    logger.warn(
      'No system mail sender configured (SMTP_HOST or GMAIL_USER/GMAIL_APP_PASSWORD) — verification emails will NOT be delivered.',
    );
  }
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REDIRECT_URI) {
    logger.warn('Gmail OAuth is not configured — users cannot connect Gmail, so outreach emails cannot be sent.');
  }
  if (!env.IMAGEKIT_PRIVATE_KEY) {
    logger.warn(
      'ImageKit is not configured — resumes/screenshots are stored on local disk; they are lost on redeploy unless server/uploads is a persistent disk.',
    );
  }
  if (env.GEMINI_API_KEY && /latest/i.test(env.GEMINI_MODEL)) {
    logger.warn(
      `GEMINI_MODEL=${env.GEMINI_MODEL} is an alias — pin a model ID from AI Studio so Google can't change quality/price under you.`,
    );
  }
  if (!env.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY is empty — extraction falls back to OCR/regex (lower quality).');
  }
  if (/localhost|127\.0\.0\.1/.test(env.API_URL)) {
    logger.warn('API_URL points at localhost — open-tracking pixels in sent emails will not work.');
  }
}

void main();
