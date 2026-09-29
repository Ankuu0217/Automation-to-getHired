import { Readable } from 'node:stream';
import { google } from 'googleapis';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { GoogleOAuthClient } from './oauth';

/**
 * Send a user's email through the Gmail REST API (HTTPS, port 443) instead of
 * SMTP. Many hosts — including Render's free plan — block outbound SMTP ports
 * (25/465/587); HTTPS always works. It is also the transport Google intends for
 * the `gmail.send` scope.
 *
 * Nodemailer still builds the MIME message (headers, HTML/text alternative,
 * attachments, In-Reply-To/References threading, Message-ID) — we only swap the
 * wire. The message goes up as a multipart media upload (`message/rfc822`),
 * which Gmail accepts up to 35 MB (the plain JSON `raw` field caps at 5 MB,
 * too small for a 10 MB résumé once base64-encoded).
 */

/** The subset of a nodemailer Transporter the mailer uses. */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<{ messageId?: string; message?: unknown }>;
}

/** Builds the raw RFC 822 message without sending it. */
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });

/**
 * Error shaped like a nodemailer SMTP error so the existing handling keeps
 * working: `responseCode` 5xx ⇒ permanent (bounce, no retry), `code: 'EAUTH'`
 * ⇒ the Gmail grant is dead (prompt reconnect), anything else ⇒ transient (retry).
 */
export class GmailApiSendError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly reason: string | null,
    public readonly responseCode?: number,
    public readonly response?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'GmailApiSendError';
  }
}

type GaxiosLikeError = {
  code?: number | string;
  status?: number;
  message?: string;
  response?: { status?: number; data?: { error?: { message?: string; errors?: Array<{ reason?: string }> } } };
  errors?: Array<{ reason?: string; message?: string }>;
};

export function toGmailSendError(err: unknown): GmailApiSendError {
  const e = (err ?? {}) as GaxiosLikeError;
  const status =
    e.response?.status ?? (typeof e.code === 'number' ? e.code : undefined) ?? e.status ?? null;
  const reason = e.errors?.[0]?.reason ?? e.response?.data?.error?.errors?.[0]?.reason ?? null;
  const message = e.response?.data?.error?.message ?? e.message ?? 'Gmail API send failed';
  const rateOrQuota = /rate|limit|quota|backend/i.test(`${reason ?? ''} ${message}`);

  // Server setup problem, not the user's: the Gmail API is not enabled in the
  // Google Cloud project. Retrying or reconnecting cannot help.
  if (
    status === 403 &&
    (reason === 'accessNotConfigured' || /has not been used in project|is disabled|SERVICE_DISABLED/i.test(message))
  ) {
    return new GmailApiSendError(message, status, reason, undefined, undefined, 'EAPI_DISABLED');
  }
  // The user connected Gmail but unticked "Send email on your behalf" on Google's consent screen.
  if (status === 403 && (reason === 'insufficientPermissions' || /insufficient (authentication )?scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message))) {
    return new GmailApiSendError(message, status, reason, undefined, undefined, 'ESCOPE');
  }
  // Token revoked/expired, or the gmail.send permission was removed.
  if (status === 401 || (status === 403 && !rateOrQuota)) {
    return new GmailApiSendError(message, status, reason, undefined, undefined, 'EAUTH');
  }
  // Bad recipient / malformed message — retrying cannot help: treat as a bounce.
  if (status === 400 && !rateOrQuota) {
    return new GmailApiSendError(message, status, reason, 550, `550 ${message}`);
  }
  // 429, 403 rate/quota, 5xx, network: transient — the queue retries later.
  return new GmailApiSendError(message, typeof status === 'number' ? status : null, reason, 421, `421 ${message}`);
}

type GmailFactory = typeof google.gmail;

export function gmailApiTransport(
  auth: GoogleOAuthClient,
  opts: { gmail?: GmailFactory; rootUrl?: string } = {},
): MailTransport {
  const gmail = (opts.gmail ?? google.gmail)({ version: 'v1', auth });
  // Per-call override of https://gmail.googleapis.com/ (tests point it at a stub).
  const callOptions = opts.rootUrl ? { rootUrl: opts.rootUrl } : {};
  return {
    async sendMail(options) {
      const built = await composer.sendMail(options);
      const raw = built.message as Buffer;
      try {
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {},
          media: { mimeType: 'message/rfc822', body: Readable.from(raw) },
        }, callOptions);
      } catch (err) {
        throw toGmailSendError(err);
      }
      // Our Message-ID (set in the MIME headers) is what follow-ups reference
      // via In-Reply-To/References for threading.
      return { messageId: built.messageId };
    },
  };
}
