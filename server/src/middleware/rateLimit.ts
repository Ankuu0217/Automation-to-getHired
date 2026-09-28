import rateLimit, { type Options } from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { ErrorCodes, errorBody } from './error';

/**
 * Rate limits (spec §8), keyed so that MANY users behind one IP (college or
 * office Wi-Fi, mobile carrier NAT) don't share a single bucket:
 *  - signed-in routes → per USER id
 *  - login            → per EMAIL (brute-force guard for one account, any IP)
 *  - anonymous auth   → per IP, but generous
 *
 * Stores are in-memory (per instance). With one instance that is exact; with
 * N instances each limit is effectively ×N — acceptable for these budgets.
 * Behind a proxy, `trust proxy` (TRUST_PROXY) must be right or every client
 * shares the proxy's IP — see app.ts.
 */

const handler = (_req: Request, res: Response): void => {
  res
    .status(429)
    .json(errorBody(ErrorCodes.RATE_LIMITED, 'Too many requests, please try again later'));
};

const skipInTests = (): boolean => process.env.NODE_ENV === 'test';

const base: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  skip: skipInTests,
};

/** Signed-in routes: one bucket per user (falls back to IP if unauthenticated). */
export const userKey = (req: Request): string =>
  req.userId ? `u:${req.userId}` : `ip:${req.ip ?? 'unknown'}`;

/** Login: one bucket per target account (normalized email). */
export const emailKey = (req: Request): string => {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim()
    ? `e:${email.trim().toLowerCase()}`
    : `ip:${req.ip ?? 'unknown'}`;
};

/** Factory (exported for tests, which need a limiter that isn't skipped). */
export function makeLimiter(opts: Partial<Options>) {
  return rateLimit({ ...base, ...opts });
}

/** Anonymous auth endpoints (register / login / verify): per IP, generous for shared networks. */
export const authIpLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 100 });

/** Registration: per IP — slows mass sign-up bots without blocking a classroom. */
export const registerLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 30 });

/** Login: 10 attempts / 15 min per account. */
export const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 10, keyGenerator: emailKey });

/** Sensitive signed-in auth actions (resend verification, delete account): per user. */
export const accountActionLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 10, keyGenerator: userKey });

/** Uploads (screenshots, pasted JDs, resumes): 60 / hour per user — six 10-screenshot batches. */
export const uploadLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyGenerator: userKey });

/** AI generation: 60 / hour per user. */
export const generateLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyGenerator: userKey });

/** Send approvals: 60 / hour per user (the daily send cap still applies on top). */
export const sendLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyGenerator: userKey });

/**
 * Concurrency gate for multipart uploads. Multer buffers each file (≤10 MB) in
 * RAM, so an unbounded burst could exhaust a 512 MB–2 GB instance. Requests
 * beyond `max` wait in line (FIFO) instead of failing.
 */
export function concurrencyGate(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next request
    else active -= 1;
  };
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = () => {
      let released = false;
      const done = () => {
        if (released) return;
        released = true;
        release();
      };
      res.once('finish', done);
      res.once('close', done);
      next();
    };
    if (active < max) {
      active += 1;
      start();
    } else {
      waiting.push(start);
    }
  };
}
