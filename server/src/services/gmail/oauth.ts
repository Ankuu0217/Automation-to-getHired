import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { env } from '../../config/env';
import { encrypt } from '../../utils/crypto';

/**
 * Gmail OAuth2 helpers (SPEC §5): consent URL, code exchange, token revoke.
 * The OAuth client ID/secret are optional env vars — when absent the connect
 * route answers 503 OAUTH_NOT_CONFIGURED and every function here stays unused.
 */

// Use the instance type of google.auth.OAuth2 itself — googleapis' Auth
// namespace can resolve to a different google-auth-library copy in the tree.
export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  // NOTE: gmail.readonly (restricted scope) is intentionally NOT requested. Reply
  // detection (SPEC §5) is a stub; asking for full inbox read now would tank
  // consent conversion and force the paid restricted-scope CASA assessment. When
  // Phase 2 ships, add it back via INCREMENTAL authorization (a second consent
  // that adds only that scope), and consider gmail.metadata first if bodies
  // aren't needed:
  // 'https://www.googleapis.com/auth/gmail.readonly',
];

export function isOAuthConfigured(): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REDIRECT_URI);
}

export function createOAuthClient(): GoogleOAuthClient {
  return new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REDIRECT_URI,
  );
}

/**
 * OAuth `state` carries the user identity through Google's redirect (the
 * callback route is unauthenticated). Short-lived JWT, purpose-bound. It also
 * carries `nonce` — the sha256 of a random value set in an httpOnly cookie on
 * the initiating browser — so the callback can bind the flow to that browser
 * and reject a completion smuggled in from anywhere else (connection-CSRF).
 */
export function signOAuthState(userId: string, nonceHash: string): string {
  return jwt.sign(
    { sub: userId, purpose: 'gmail-oauth', nonce: nonceHash },
    env.JWT_SECRET,
    { expiresIn: '10m' },
  );
}

export function verifyOAuthState(state: string): { sub: string; nonce: string } {
  const payload = jwt.verify(state, env.JWT_SECRET) as {
    sub: string;
    purpose?: string;
    nonce?: string;
  };
  if (payload.purpose !== 'gmail-oauth') throw new Error('Invalid OAuth state');
  return { sub: payload.sub, nonce: payload.nonce ?? '' };
}

export function buildConsentUrl(state: string): string {
  return createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh token on every (re)connect
    scope: GMAIL_SCOPES,
    state,
  });
}

export interface ExchangedGmailTokens {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiry: Date | null;
  connectedEmail: string;
}

/** Exchange the authorization code for tokens and resolve the account email. */
export async function exchangeCode(code: string): Promise<ExchangedGmailTokens> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error('Google did not return an access token');

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error('Could not resolve the connected Gmail address');

  return {
    accessTokenEnc: encrypt(tokens.access_token),
    // Google only sends a refresh token on first consent / with prompt=consent;
    // keep the stored one if this exchange didn't include a new one (caller merges).
    refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    connectedEmail: data.email.toLowerCase(),
  };
}

/** Best-effort revoke — never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await createOAuthClient().revokeToken(token);
  } catch {
    // Token may already be invalid/expired; disconnect proceeds regardless.
  }
}
