import nodemailer, { type Transporter } from 'nodemailer';
import path from 'node:path';
import fs from 'node:fs';
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

/**
 * True only for the definitive "this user's grant is dead" signal from Google's
 * token endpoint: the OAuth error code `invalid_grant`. Prefer the structured
 * code; fall back to the message. Deliberately does NOT match broad strings like
 * "unauthorized" / "invalid credentials" — e.g. `unauthorized_client` is a
 * server-side client misconfig (wrong/rotated OAuth client), NOT a per-user
 * revocation, and matching it would mass-flag every connected user as
 * needs_reconnect on the next health sweep. Exported so that sweep can reuse it.
 */
export function isInvalidGrant(err: unknown): boolean {
  const structured = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  const signal = typeof structured === 'string' ? structured : err instanceof Error ? err.message : String(err);
  return /\binvalid_grant\b/i.test(signal);
}

/**
 * Per-user access-token cache. Concurrent sends for one user reuse a single
 * fresh token instead of each triggering a redundant refresh (which wastes
 * calls and can churn a rotating refresh token). Cleared on disconnect /
 * reconnect / invalid-grant so a revoked account can't keep sending on a cached
 * token.
 */
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Drop a user's cached access token (call on disconnect and reconnect). */
export function clearAccessTokenCache(userId: string): void {
  accessTokenCache.delete(userId);
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

  const userId = String(user._id);
  const refreshToken = decrypt(gmailAuth.refreshTokenEnc);

  let accessToken: string;
  const cached = accessTokenCache.get(userId);
  // Reuse the cached token only when it's valid for >60s AND the grant isn't
  // flagged needsReconnect. The DB flag is the cross-process invalidation signal:
  // every send re-reads the user, so once ANY instance (or the health sweep)
  // flags a revoked grant, all instances stop serving cached tokens and
  // re-validate — instead of one process happily sending on a stale token.
  if (cached && cached.expiresAt > Date.now() + 60_000 && !gmailAuth.needsReconnect) {
    accessToken = cached.token;
  } else {
    accessTokenCache.delete(userId); // evict stale/expired/flagged entry (bounds memory)
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
          logger.warn({ err, userId }, 'Failed to persist refreshed Gmail token');
        }
      })();
    });

    try {
      const res = await client.getAccessToken();
      if (!res.token) throw new Error('empty access token');
      accessToken = res.token;
      const expiresAt = client.credentials.expiry_date ?? Date.now() + 55 * 60 * 1000;
      accessTokenCache.set(userId, { token: accessToken, expiresAt });
      // A working refresh means the connection recovered — clear any stale flag.
      // Guarded on the exact refresh token we used so we never touch a grant that
      // was reconnected/disconnected under us (the ciphertext changes on rewrite).
      if (gmailAuth.needsReconnect) {
        await User.updateOne(
          { _id: user._id, 'gmailAuth.refreshTokenEnc': gmailAuth.refreshTokenEnc },
          { $set: { 'gmailAuth.needsReconnect': false } },
        );
      }
    } catch (err) {
      if (isInvalidGrant(err)) {
        // Revoked/expired at Google: reflect it in the UI (not just a banner) and
        // drop the cached token so we stop retrying a dead grant. The token-match
        // filter prevents a stale in-flight job from clobbering a fresh reconnect
        // that landed while our getAccessToken() was in flight.
        accessTokenCache.delete(userId);
        await User.updateOne(
          { _id: user._id, 'gmailAuth.refreshTokenEnc': gmailAuth.refreshTokenEnc },
          { $set: { 'gmailAuth.needsReconnect': true } },
        );
        throw new GmailNotConnectedError(
          'Gmail connection expired — reconnect in Settings to resume sending',
        );
      }
      throw err;
    }
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

const CAPTURE_DIR = path.resolve(__dirname, '../../uploads/captured-emails');

/**
 * Dev-only capture transport. When no Gmail OAuth or app-password is configured,
 * emails are written to disk as JSON instead of being sent. This lets developers
 * test the full send flow end-to-end without real SMTP credentials, while still
 * exercising Nodemailer's composition + attachment handling.
 */
function devCaptureTransport(): Transporter | null {
  if (env.NODE_ENV === 'production') return null;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  return nodemailer.createTransport({
    jsonTransport: true,
    // Nodemailer ignores pool/connection settings for jsonTransport, but we can
    // still attach a custom send handler via the plugin system below.
  });
}

/** Dev fallback transport: Gmail App Password from env. */
function appPasswordTransport(): Transporter | null {
  // Never a multi-user production path: it would send every user's outreach from
  // one shared mailbox with their name spoofed as the display name (deliverability
  // + impersonation). Locked to non-production. (The system/transactional sender
  // legitimately uses SMTP/app-password — that's separate, see sendSystemMail.)
  if (env.NODE_ENV === 'production') return null;
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
}

/** Exported for tests and future admin tooling. */
export async function transportForUser(
  user: IUser,
): Promise<{ transporter: Transporter; fromEmail: string; capture?: boolean; usesOAuth?: boolean }> {
  if (user.gmailAuth?.refreshTokenEnc && user.gmailAuth.connectedEmail) {
    return {
      transporter: await oauthTransport(user),
      fromEmail: user.gmailAuth.connectedEmail,
      usesOAuth: true,
    };
  }
  const fallback = appPasswordTransport();
  if (fallback) return { transporter: fallback, fromEmail: env.GMAIL_USER! };
  const capture = devCaptureTransport();
  if (capture) return { transporter: capture, fromEmail: user.email, capture: true };
  throw new GmailNotConnectedError();
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const user = await User.findById(input.userId).select(
    '+gmailAuth.accessTokenEnc +gmailAuth.refreshTokenEnc +gmailAuth.expiry',
  );
  if (!user) throw new GmailNotConnectedError('Account not found while sending');

  const { transporter, fromEmail, capture, usesOAuth } = await transportForUser(user);
  const from = `"${user.name.replace(/["\\]/g, '')}" <${fromEmail}>`;

  logger.info(
    { userId: input.userId, from: fromEmail, to: input.to, capture: Boolean(capture) },
    'sendMail: attempting delivery',
  );

  try {
    const info = await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references ? { references: input.references } : {}),
    });

    const messageId = info.messageId ?? '';
    if (capture) {
      const filename = `${Date.now()}-${input.to.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      const filepath = path.join(CAPTURE_DIR, filename);
      fs.writeFileSync(filepath, info.message as string);
      logger.info(
        { userId: input.userId, messageId, filepath },
        'Email captured (dev mode — no real SMTP credentials)',
      );
    } else {
      // Metadata only — never the body, subject content is fine to keep out too.
      logger.info({ userId: input.userId, messageId }, 'Email sent');
    }
    return { messageId };
  } catch (err) {
    const smtp = err as {
      code?: string;
      responseCode?: number;
      response?: string;
      command?: string;
    };

    // OAuth access token rejected at SMTP layer (e.g. revoked or expired between
    // refresh and send). Flag the grant so the UI prompts reconnect and we stop
    // retrying a dead token; fall back to app-password in dev, or fail cleanly.
    if (
      usesOAuth &&
      (smtp.responseCode === 535 || smtp.code === 'EAUTH' || /Username and Password not accepted/i.test(smtp.response || ''))
    ) {
      logger.warn({ userId: input.userId }, 'OAuth SMTP auth rejected — marking Gmail connection for reconnect');
      await User.updateOne(
        { _id: input.userId, 'gmailAuth.refreshTokenEnc': user.gmailAuth!.refreshTokenEnc },
        { $set: { 'gmailAuth.needsReconnect': true } },
      );
      clearAccessTokenCache(input.userId);
      throw new GmailNotConnectedError(
        'Gmail connection expired — reconnect in Settings to resume sending',
      );
    }

    logger.warn(
      {
        err,
        userId: input.userId,
        from: fromEmail,
        to: input.to,
        responseCode: smtp.responseCode,
        response: smtp.response,
      },
      'sendMail: delivery failed',
    );
    throw err;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * System transactional mail (email verification, M-verify).
 *
 * A no-reply sender INDEPENDENT of any user's connected Gmail — a brand-new
 * signup has no Gmail. Transport priority:
 *   1. Dedicated SMTP (env.SMTP_*) — the prod path (Resend/Postmark/SES/etc.
 *      all speak SMTP).
 *   2. The existing app-password Gmail account (env.GMAIL_USER/…_APP_PASSWORD)
 *      as the system sender.
 *   3. Dev/test: never send or hang — nodemailer's jsonTransport, and the full
 *      message (verification link included) is logged in dev only.
 * `from` = env.MAIL_FROM, falling back to the transport user.
 * ──────────────────────────────────────────────────────────────────────── */

export interface SystemMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type SystemTransport = { transporter: Transporter; from: string; usesJson: boolean };
let systemTransport: SystemTransport | null = null;

function getSystemTransport(): SystemTransport {
  if (systemTransport) return systemTransport;

  if (env.SMTP_HOST) {
    const port = env.SMTP_PORT ?? 587;
    systemTransport = {
      transporter: nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      }),
      from: env.MAIL_FROM || env.SMTP_USER || 'no-reply@localhost',
      usesJson: false,
    };
    return systemTransport;
  }

  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    systemTransport = {
      transporter: nodemailer.createTransport({
        service: 'gmail',
        auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
      }),
      from: env.MAIL_FROM || env.GMAIL_USER,
      usesJson: false,
    };
    return systemTransport;
  }

  // Dev/test: jsonTransport serializes the message instead of sending it.
  systemTransport = {
    transporter: nodemailer.createTransport({ jsonTransport: true }),
    from: env.MAIL_FROM || 'GetHired <no-reply@localhost>',
    usesJson: true,
  };
  return systemTransport;
}

/** Whether the system sender is currently the dev/test jsonTransport (no real send). */
export function systemMailUsesJsonTransport(): boolean {
  return getSystemTransport().usesJson;
}

let lastSystemMessage: string | null = null;
/** Test-only: the last jsonTransport-serialized system message (contains the link). */
export function getLastSystemMessage(): string | null {
  return lastSystemMessage;
}

export async function sendSystemMail(input: SystemMailInput): Promise<{ messageId: string }> {
  const { transporter, from, usesJson } = getSystemTransport();
  const info = (await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  })) as { messageId?: string; message?: unknown };

  const messageId = info.messageId ?? '';
  if (usesJson) {
    lastSystemMessage = typeof info.message === 'string' ? info.message : JSON.stringify(info.message ?? '');
    // Dev only: the message body carries the raw token in its link.
    if (env.NODE_ENV !== 'production') {
      logger.info({ to: input.to, subject: input.subject }, 'System mail captured (jsonTransport, not sent)');
    }
  } else {
    // Metadata only — never the token/link.
    logger.info({ to: input.to, messageId }, 'System mail sent');
  }
  return { messageId };
}
