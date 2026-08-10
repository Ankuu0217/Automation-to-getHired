import crypto from 'node:crypto';
import { ErrorCodes } from '@jobmail/shared';
import { env } from '../config/env';
import { AppError } from '../middleware/error';
import type { IUser } from '../models/User';
import { User } from '../models/User';
import { sha256 } from '../utils/crypto';
import { logger } from '../utils/logger';
import { sendSystemMail } from './mailer';

/**
 * Email verification (M-verify).
 *
 * Security model (SPEC §security):
 *  - Token is 32 random bytes; only its sha256 is stored at rest, with a 24h
 *    expiry and single-use semantics. Issuing a new token rotates (overwrites)
 *    the old one. The raw token only ever appears in the emailed link.
 *  - A 60s per-account resend cooldown sits on top of the auth rate limiter.
 *  - Verification mail is sent by the system sender (sendSystemMail), never a
 *    user's Gmail, so a brand-new signup with no Gmail can still be verified.
 */

const TOKEN_BYTES = 32;
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const RESEND_COOLDOWN_MS = 60 * 1000; // 60s

function verificationLink(token: string): string {
  // env.CLIENT_URL is the public web origin (reused per the "APP_URL" spec note).
  return `${env.CLIENT_URL.replace(/\/+$/, '')}/verify-email?token=${token}`;
}

function buildEmail(link: string): { subject: string; text: string; html: string } {
  const subject = 'Verify your email to start sending';
  const text = [
    'Welcome to GetHired.',
    '',
    'Confirm this is your email so you can start sending outreach. Open the link below:',
    link,
    '',
    'This link expires in 24 hours.',
    '',
    "If you didn't create a GetHired account, ignore this email.",
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222f30">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:440px" cellpadding="0" cellspacing="0">
      <tr><td style="background:#ffffff;border:1px solid #c9cbbe;border-radius:16px;padding:32px">
        <p style="margin:0 0 8px;font-size:13px;letter-spacing:-0.02em;text-transform:uppercase;color:#4d5757">GetHired</p>
        <h1 style="margin:0 0 12px;font-size:22px;font-weight:400;line-height:1.3">Verify your email to start sending.</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4d5757">Confirm this is your email so GetHired can send outreach on your behalf.</p>
        <a href="${link}" style="display:inline-block;background:#222f30;color:#ffffff;text-decoration:none;font-size:14px;padding:12px 20px;border-radius:8px">Verify email</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#4d5757">This link expires in 24 hours. If you didn't create a GetHired account, ignore this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * Issue (or rotate) a verification token for `user` and email the link.
 *
 * The passed user doc must have `emailVerification` selected when a cooldown
 * check is desired (the /resend path selects it; a freshly-created user has
 * none, so registration is never throttled). Returns nothing — the raw token
 * leaves only inside the email link.
 */
export async function issueEmailVerification(user: IUser): Promise<void> {
  const existing = user.emailVerification;
  if (existing?.sentAt && Date.now() - existing.sentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError(
      429,
      ErrorCodes.RATE_LIMITED,
      'Please wait a minute before requesting another verification email.',
    );
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const now = new Date();
  user.emailVerification = {
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + EXPIRY_MS),
    sentAt: now,
  };
  await user.save();

  const link = verificationLink(token);
  const { subject, text, html } = buildEmail(link);
  await sendSystemMail({ to: user.email, subject, text, html });
  logger.info({ userId: String(user._id) }, 'Email verification issued');
}

export type VerifyResult =
  | { ok: true; user: IUser }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * Verify a raw token. Single-use: a successful verify sets emailVerified and
 * unsets emailVerification. Distinguishes invalid (unknown/consumed) from
 * expired so the UI can offer a resend on the latter.
 */
export async function verifyEmailToken(token: string): Promise<VerifyResult> {
  const tokenHash = sha256(token);
  const user = await User.findOne({ 'emailVerification.tokenHash': tokenHash }).select(
    '+emailVerification',
  );
  if (!user || !user.emailVerification) return { ok: false, reason: 'invalid' };

  if (user.emailVerification.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  user.emailVerified = true;
  user.emailVerification = undefined;
  await user.save();
  logger.info({ userId: String(user._id) }, 'Email verified');
  return { ok: true, user };
}
