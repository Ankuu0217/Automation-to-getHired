import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { ErrorCodes, type GmailConnectResponse, type GmailStatusResponse } from '@jobmail/shared';
import { User } from '../models/User';
import { AppError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { decrypt, sha256 } from '../utils/crypto';
import { clearAccessTokenCache } from '../services/mailer';
import { logger } from '../utils/logger';
import {
  buildConsentUrl,
  exchangeCode,
  isOAuthConfigured,
  revokeToken,
  signOAuthState,
  verifyOAuthState,
} from '../services/gmail/oauth';

export const gmailRouter = Router();

/**
 * Per-browser CSRF nonce for the OAuth round-trip. Set on /connect, checked on
 * /callback. SameSite=Lax (not Strict) so it survives the top-level GET redirect
 * back from accounts.google.com; httpOnly so page scripts can't read it.
 */
const GMAIL_OAUTH_NONCE_COOKIE = 'jm_gmail_oauth';
const nonceCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.COOKIE_SECURE,
  path: '/',
};

const oauthNotConfigured = () =>
  new AppError(
    503,
    ErrorCodes.OAUTH_NOT_CONFIGURED,
    'Gmail OAuth is not configured on this server (set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REDIRECT_URI). Use the app-password fallback or contact the admin.',
  );

/**
 * GET /gmail/connect — returns the Google consent URL; the SPA navigates the
 * user there. 503 OAUTH_NOT_CONFIGURED when the server has no OAuth credentials.
 */
gmailRouter.get('/connect', requireAuth, (req, res, next) => {
  try {
    if (!isOAuthConfigured()) throw oauthNotConfigured();
    // Bind this flow to the initiating browser: a random nonce goes in an
    // httpOnly cookie, and only its hash travels in the (readable) state JWT.
    const nonce = crypto.randomBytes(32).toString('hex');
    res.cookie(GMAIL_OAUTH_NONCE_COOKIE, nonce, { ...nonceCookieOptions, maxAge: 10 * 60 * 1000 });
    const body: GmailConnectResponse = {
      url: buildConsentUrl(signOAuthState(req.userId!, sha256(nonce))),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

function redirectToSettings(res: Response, param: string): void {
  res.redirect(`${env.CLIENT_URL}/settings?gmail=${param}`);
}

/**
 * GET /gmail/callback — Google redirects here with ?code&state. Unauthenticated
 * route: identity comes from the signed state JWT. Exchanges the code,
 * encrypts tokens into User.gmailAuth, then redirects back to Settings.
 */
gmailRouter.get('/callback', async (req, res, next) => {
  try {
    if (!isOAuthConfigured()) throw oauthNotConfigured();
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      redirectToSettings(res, error === 'access_denied' ? 'denied' : 'error');
      return;
    }

    // Post-verification failures are handled by redirecting back to the app (this
    // is a top-level browser navigation on the API origin) rather than throwing —
    // a raw JSON error page would strand the user with no way back.
    let userId: string;
    let expectedNonceHash: string;
    try {
      ({ sub: userId, nonce: expectedNonceHash } = verifyOAuthState(state));
    } catch {
      // Commonly: the user lingered >10 min on Google's consent screen and the
      // 10-min state JWT expired. Send them back to retry.
      redirectToSettings(res, 'expired');
      return;
    }

    // CSRF: the callback must land in the same browser that started the flow.
    const nonce = req.cookies?.[GMAIL_OAUTH_NONCE_COOKIE] as string | undefined;
    res.clearCookie(GMAIL_OAUTH_NONCE_COOKIE, nonceCookieOptions);
    if (!nonce || !expectedNonceHash || sha256(nonce) !== expectedNonceHash) {
      redirectToSettings(res, 'error');
      return;
    }

    let tokens: Awaited<ReturnType<typeof exchangeCode>>;
    try {
      tokens = await exchangeCode(code);
    } catch (err) {
      logger.warn({ err, userId }, 'Gmail callback: code exchange failed');
      redirectToSettings(res, 'error');
      return;
    }

    const user = await User.findById(userId).select('+gmailAuth.refreshTokenEnc');
    if (!user) {
      redirectToSettings(res, 'error');
      return;
    }

    user.gmailAuth.accessTokenEnc = tokens.accessTokenEnc;
    // A re-consent without prompt may omit the refresh token — keep the old one.
    if (tokens.refreshTokenEnc) user.gmailAuth.refreshTokenEnc = tokens.refreshTokenEnc;
    if (!user.gmailAuth.refreshTokenEnc) {
      logger.warn({ userId }, 'Gmail connect: no refresh token returned — sending will fail on expiry');
    }
    user.gmailAuth.expiry = tokens.expiry ?? undefined;
    user.gmailAuth.connectedEmail = tokens.connectedEmail;
    user.gmailAuth.needsReconnect = false; // a fresh (re)connect clears the reconnect state
    user.lastSendError = null; // reconnect clears the mid-queue pause banner
    await user.save();
    clearAccessTokenCache(userId); // a new grant invalidates any cached access token

    redirectToSettings(res, 'connected');
  } catch (err) {
    next(err);
  }
});

/** DELETE /gmail/disconnect — clears gmailAuth, best-effort token revoke. */
gmailRouter.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId!).select(
      '+gmailAuth.accessTokenEnc +gmailAuth.refreshTokenEnc +gmailAuth.expiry',
    );
    if (!user) throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account not found');

    const refreshTokenEnc = user.gmailAuth?.refreshTokenEnc;
    const accessTokenEnc = user.gmailAuth?.accessTokenEnc;
    if (isOAuthConfigured() && (refreshTokenEnc || accessTokenEnc)) {
      // Best-effort revoke — disconnect must succeed even when the stored token is
      // corrupt or encrypted under a rotated-out key, so decrypt is guarded too
      // (mirrors the account-deletion path). Refresh token revokes the whole grant.
      try {
        await revokeToken(decrypt((refreshTokenEnc ?? accessTokenEnc)!));
      } catch (err) {
        logger.warn({ err, userId: req.userId }, 'Gmail disconnect: revoke failed — clearing locally anyway');
      }
    }

    user.gmailAuth = {};
    await user.save();
    clearAccessTokenCache(req.userId!); // stop any cached token from sending post-disconnect

    const body: GmailStatusResponse = { connected: false, connectedEmail: null };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
