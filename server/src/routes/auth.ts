import { Router } from 'express';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import {
  ErrorCodes,
  loginSchema,
  registerSchema,
  settingsUpdateSchema,
  type PublicUser,
} from '@jobmail/shared';
import { User, type IUser } from '../models/User';
import { Profile } from '../models/Profile';
import { JobPost } from '../models/JobPost';
import { Application } from '../models/Application';
import { EmailTemplate } from '../models/EmailTemplate';
import { EmailEvent } from '../models/EmailEvent';
import { AppError, errorBody } from '../middleware/error';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { decrypt } from '../utils/crypto';
import { logger } from '../utils/logger';
import { isOAuthConfigured, revokeToken } from '../services/gmail/oauth';
import { cancelUserJobs } from '../services/queue';
import {
  clearAuthCookies,
  hasRefreshToken,
  REFRESH_COOKIE,
  removeRefreshToken,
  setAuthCookies,
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  verifyRefreshToken,
} from '../services/tokenService';

const BCRYPT_COST = 12;

export const authRouter = Router();

function toPublicUser(user: IUser): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    gmailConnected: Boolean(user.gmailAuth?.connectedEmail),
    connectedEmail: user.gmailAuth?.connectedEmail ?? null,
    lastSendError: user.lastSendError ?? null,
    settings: {
      autoSend: user.settings.autoSend,
      dailySendCap: user.settings.dailySendCap,
      followUpEnabled: user.settings.followUpEnabled,
      tone: user.settings.tone,
      // Pre-Phase-9 documents have no weeklySendGoal — read as "no goal set".
      weeklySendGoal: user.settings.weeklySendGoal ?? null,
    },
    createdAt: user.createdAt.toISOString(),
  };
}

async function issueSession(res: Parameters<typeof setAuthCookies>[0], user: IUser): Promise<void> {
  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());
  await storeRefreshToken(user, refreshToken);
  setAuthCookies(res, accessToken, refreshToken);
}

authRouter.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await User.create({ name, email, passwordHash });
    // 1:1 profile shell created at registration so GET /profile never 404s.
    await Profile.create({ userId: user._id, fullName: name });
    await issueSession(res, user);
    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+refreshTokenHashes');
    // Uniform error — don't reveal which part failed.
    const invalid = new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid email or password');
    if (!user) throw invalid;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw invalid;
    await issueSession(res, user);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (refreshToken) {
      try {
        const { sub } = verifyRefreshToken(refreshToken);
        const user = await User.findById(sub).select('+refreshTokenHashes');
        if (user) await removeRefreshToken(user, refreshToken);
      } catch {
        // Token already invalid — nothing to revoke.
      }
    }
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Refresh-token rotation: a valid, stored refresh token is exchanged for a
 * new access+refresh pair and the old one is revoked. A well-formed but
 * unknown token is treated as reuse → all sessions revoked.
 */
authRouter.post('/refresh', async (req, res, next) => {
  const unauthorized = () =>
    res.status(401).json(errorBody(ErrorCodes.UNAUTHORIZED, 'Session expired, please log in again'));
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) {
      unauthorized();
      return;
    }
    let sub: string;
    try {
      ({ sub } = verifyRefreshToken(refreshToken));
    } catch {
      clearAuthCookies(res);
      unauthorized();
      return;
    }
    const user = await User.findById(sub).select('+refreshTokenHashes');
    if (!user) {
      clearAuthCookies(res);
      unauthorized();
      return;
    }
    if (!hasRefreshToken(user, refreshToken)) {
      // Token reuse / stale rotation — revoke every session for safety.
      user.refreshTokenHashes = [];
      await user.save();
      clearAuthCookies(res);
      unauthorized();
      return;
    }
    await removeRefreshToken(user, refreshToken);
    await issueSession(res, user);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account not found');
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** Update automation settings (autoSend, dailySendCap, followUpEnabled, tone). */
authRouter.patch('/settings', requireAuth, validate(settingsUpdateSchema), async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account not found');
    Object.assign(user.settings, req.body);
    await user.save();
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /auth/account (SPEC §8 "Delete my data") — irreversible full wipe:
 * best-effort Gmail token revoke, every document the user owns (profile, job
 * posts, applications, templates, tracking events), queued send/follow-up
 * jobs, and the upload files (screenshots + resume). Ends the session.
 */
authRouter.delete('/account', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId!;
    const user = await User.findById(userId).select(
      '+gmailAuth.accessTokenEnc +gmailAuth.refreshTokenEnc',
    );
    if (!user) throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account not found');

    // Best-effort revoke — deletion must succeed even when Google is
    // unreachable or the stored token is corrupt (mirrors /gmail/disconnect).
    const tokenEnc = user.gmailAuth?.refreshTokenEnc ?? user.gmailAuth?.accessTokenEnc;
    if (isOAuthConfigured() && tokenEnc) {
      try {
        await revokeToken(decrypt(tokenEnc));
      } catch (err) {
        logger.warn({ err, userId }, 'Account deletion: Gmail token revoke failed — continuing');
      }
    }

    const [jobPosts, applications, profile] = await Promise.all([
      JobPost.find({ userId }).select('screenshotPath').lean(),
      Application.find({ userId }).select('_id').lean(),
      Profile.findOne({ userId }).select('resumeFile.path').lean(),
    ]);
    const applicationIds = applications.map((a) => String(a._id));

    await cancelUserJobs(userId, applicationIds);

    await Promise.all([
      EmailEvent.deleteMany({ applicationId: { $in: applicationIds } }),
      Application.deleteMany({ userId }),
      JobPost.deleteMany({ userId }),
      EmailTemplate.deleteMany({ userId }),
      Profile.deleteOne({ userId }),
      User.deleteOne({ _id: userId }),
    ]);

    // Upload files (flat per-type dirs, absolute paths stored on the docs) —
    // best-effort per file so a missing file never blocks the wipe.
    const filePaths = [
      ...jobPosts.map((j) => j.screenshotPath),
      ...(profile?.resumeFile ? [profile.resumeFile.path] : []),
    ];
    await Promise.all(filePaths.map((p) => fs.promises.unlink(p).catch(() => undefined)));

    clearAuthCookies(res);
    logger.info({ userId }, 'Account deleted — all user data wiped');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
