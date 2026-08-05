import { Router, type Response } from 'express';
import { ErrorCodes, type GmailConnectResponse, type GmailStatusResponse } from '@jobmail/shared';
import { User } from '../models/User';
import { AppError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { decrypt } from '../utils/crypto';
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
    const body: GmailConnectResponse = { url: buildConsentUrl(signOAuthState(req.userId!)) };
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

    let userId: string;
    try {
      ({ sub: userId } = verifyOAuthState(state));
    } catch {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Invalid or expired OAuth state — restart the connect flow');
    }

    const tokens = await exchangeCode(code);
    const user = await User.findById(userId).select('+gmailAuth.refreshTokenEnc');
    if (!user) throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account not found');

    user.gmailAuth.accessTokenEnc = tokens.accessTokenEnc;
    // A re-consent without prompt may omit the refresh token — keep the old one.
    if (tokens.refreshTokenEnc) user.gmailAuth.refreshTokenEnc = tokens.refreshTokenEnc;
    if (!user.gmailAuth.refreshTokenEnc) {
      logger.warn({ userId }, 'Gmail connect: no refresh token returned — sending will fail on expiry');
    }
    user.gmailAuth.expiry = tokens.expiry ?? undefined;
    user.gmailAuth.connectedEmail = tokens.connectedEmail;
    user.lastSendError = null; // reconnect clears the mid-queue pause banner
    await user.save();

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
      // Refresh token revokes the whole grant; fall back to the access token.
      const token = decrypt((refreshTokenEnc ?? accessTokenEnc)!);
      await revokeToken(token);
    }

    user.gmailAuth = {};
    await user.save();

    const body: GmailStatusResponse = { connected: false, connectedEmail: null };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
