import mongoose from 'mongoose';
import { createApp } from './app';
import { env } from './config/env';
import { initQueue, stopQueue } from './services/queue';
import { logger } from './utils/logger';

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
  } catch (err) {
    logger.error(
      { err },
      'MongoDB connection failed — start it with `docker compose up -d`. The server keeps running and will report DB errors per request.',
    );
  }

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close();
    await stopQueue().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
