import nodemailer, { type Transporter } from 'nodemailer';
import { User, type IUser } from '../models/User';
import { env } from '../config/env';
import { decrypt, encrypt } from '../utils/crypto';
import { createOAuthClient, isOAuthConfigured } from './gmail/oauth';
import { logger } from '../utils/logger';

/**
 * Mail transport factory + send (SPEC §5).
 *
 * Transport priority per send:
 *  1. The user's connected Gmail (OAuth2, tokens decrypted from User.gmailAuth,
 *     auto-refreshed via googleapis and persisted back).
 *  2. Dev fallback: Gmail App Password from env (GMAIL_USER/GMAIL_APP_PASSWORD).
 *  3. Neither → GmailNotConnectedError (the queue treats it as retryable and
 *     surfaces it via User.lastSendError).
 *
 * Never log email bodies or tokens (SPEC §8) — only send metadata.
 */

/** Thrown when no usable transport exists; the queue retries with backoff. */
export class GmailNotConnectedError extends Error {
  readonly code = 'GMAIL_NOT_CONNECTED';
  constructor(message = 'Gmail is not connected — reconnect in Settings to resume sending') {
    super(message);
    this.name = 'GmailNotConnectedError';
  }
}

/**
 * Bounce classification, phase 1 (SPEC §5 webhook-less): true when the SMTP
 * server rejected the message permanently — 5xx response code or a rejected
 * recipient list. Nodemailer surfaces these as `responseCode`/`response`/
 * `rejected` on the thrown error. Transient 4xx and connection errors return
 * false (the queue may retry those).
 */
export function isPermanentSendError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { responseCode?: unknown; response?: unknown; rejected?: unknown };
  if (typeof e.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600) {
    return true;
  }
  if (typeof e.response === 'string' && /^\s*5\d{2}\b/.test(e.response)) return true;
  if (Array.isArray(e.rejected) && e.rejected.length > 0) return true;
  return false;
}

export interface MailAttachment {
  filename: string;
  path: string;
}

export interface SendMailInput {
  userId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  /** Threading headers for follow-ups (M5) — stored messageId of the prior email. */
  inReplyTo?: string;
  references?: string;
}

export interface SendMailResult {
  messageId: string;
}

function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant|invalid credentials|unauthorized/i.test(msg);
}

/**
 * Build an OAuth2 transport for a user with connected Gmail. Refreshes the
 * access token via googleapis (which refreshes from the stored refresh token)
 * and persists refreshed credentials back, encrypted.
 */
async function oauthTransport(user: IUser): Promise<Transporter> {
  const gmailAuth = user.gmailAuth;
  if (!gmailAuth?.refreshTokenEnc || !gmailAuth.connectedEmail) {
    throw new GmailNotConnectedError();
  }
  if (!isOAuthConfigured()) {
    throw new GmailNotConnectedError(
      'Gmail OAuth is not configured on this server and no app-password fallback is available',
    );
  }

  const refreshToken = decrypt(gmailAuth.refreshTokenEnc);
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  // Persist refreshed credentials (encrypted) whenever googleapis renews them.
  client.on('tokens', (tokens) => {
    void (async () => {
      try {
        const fresh = await User.findById(user._id).select(
          '+gmailAuth.accessTokenEnc +gmailAuth.refreshTokenEnc',
        );
        if (!fresh?.gmailAuth) return;
        if (tokens.access_token) fresh.gmailAuth.accessTokenEnc = encrypt(tokens.access_token);
        if (tokens.refresh_token) fresh.gmailAuth.refreshTokenEnc = encrypt(tokens.refresh_token);
        if (tokens.expiry_date) fresh.gmailAuth.expiry = new Date(tokens.expiry_date);
        await fresh.save();
      } catch (err) {
        logger.warn({ err, userId: String(user._id) }, 'Failed to persist refreshed Gmail token');
      }
    })();
  });

  let accessToken: string;
  try {
    const res = await client.getAccessToken();
    if (!res.token) throw new Error('empty access token');
    accessToken = res.token;
  } catch (err) {
    if (isInvalidGrant(err)) throw new GmailNotConnectedError('Gmail connection expired — reconnect in Settings to resume sending');
    throw err;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: gmailAuth.connectedEmail,
      clientId: env.GMAIL_CLIENT_ID,
      clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken,
      accessToken,
    },
  });
}

/** Dev fallback transport: Gmail App Password from env. */
function appPasswordTransport(): Transporter | null {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
}

/** Exported for tests and future admin tooling. */
export async function transportForUser(user: IUser): Promise<{ transporter: Transporter; fromEmail: string }> {
  if (user.gmailAuth?.refreshTokenEnc && user.gmailAuth.connectedEmail) {
    return { transporter: await oauthTransport(user), fromEmail: user.gmailAuth.connectedEmail };
  }
  const fallback = appPasswordTransport();
  if (fallback) return { transporter: fallback, fromEmail: env.GMAIL_USER! };
  throw new GmailNotConnectedError();
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const user = await User.findById(input.userId).select(
    '+gmailAuth.accessTokenEnc +gmailAuth.refreshTokenEnc +gmailAuth.expiry',
  );
  if (!user) throw new GmailNotConnectedError('Account not found while sending');

  const { transporter, fromEmail } = await transportForUser(user);
  const info = await transporter.sendMail({
    from: `"${user.name.replace(/["\\]/g, '')}" <${fromEmail}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.references ? { references: input.references } : {}),
  });

  const messageId = info.messageId ?? '';
  // Metadata only — never the body, subject content is fine to keep out too.
  logger.info({ userId: input.userId, messageId }, 'Email sent');
  return { messageId };
}
