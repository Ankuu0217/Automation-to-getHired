import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { ErrorCodes, errorBody } from './error';

const handler = (_req: Request, res: Response): void => {
  res
    .status(429)
    .json(errorBody(ErrorCodes.RATE_LIMITED, 'Too many requests, please try again later'));
};

const base = {
  standardHeaders: true as const,
  legacyHeaders: false,
  handler,
};

const skipInTests = (): boolean => process.env.NODE_ENV === 'test';

/** Auth endpoints: 10 requests / 15 min (spec §8). */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: skipInTests,
});

/** Upload endpoints: 20 / hour (spec §8). Applies to resume now, screenshots in M2. */
export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  skip: skipInTests,
});

/** AI generation endpoints: 30 / hour (spec §8). Wired up in M3. */
export const generateLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  skip: skipInTests,
});

/** Send approvals: 30 / hour — same budget as generation (M3). */
export const sendLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  skip: skipInTests,
});
