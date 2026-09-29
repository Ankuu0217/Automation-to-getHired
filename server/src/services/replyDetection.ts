import { Application } from '../models/Application';
import { User, type IUser } from '../models/User';
import { google } from 'googleapis';
import { createOAuthClient } from './gmail/oauth';
import { decrypt } from '../utils/crypto';
import { createNotification } from './notifications';
import { recordBounce } from './jobs/followups';
import { stopFollowUpSequence } from './queue';
import { markLatestEmailReplied } from './replies';
import { logger } from '../utils/logger';

/**
 * Reply detection (SPEC §5) — PHASE 2 STUB.
 *
 * Phase 1 ships the manual "Mark as replied" button (routes/applications.ts,
 * backed by services/replies.ts). Phase 2 polls the Gmail API `history.list`
 * for inbound messages from each application's hrEmail and applies them here.
 *
 * What exists now:
 *  - the DetectedReply / ReplyDetectionProvider contract;
 *  - GmailHistoryReplyDetector, a documented stub returning no replies;
 *  - applyDetectedReply, the real matching/bookkeeping half (reused as-is
 *    once a provider returns actual data);
 *  - processPollReplies, the Agenda `poll-replies` processor — registered in
 *    queue.ts but intentionally never scheduled (see initQueue).
 *
 * Phase 2 implementation notes: use googleapis gmail.users.history.list with
 * the user's stored OAuth tokens (services/gmail/oauth.ts), filter messages
 * whose From matches an Application.hrEmail, then call applyDetectedReply.
 * Requires the gmail.readonly scope at connect time.
 */

/** A reply discovered in the user's mailbox. */
export interface DetectedReply {
  /** Sender address, matched case-insensitively against Application.hrEmail. */
  fromEmail: string;
  /** RFC-822 Message-ID of the inbound message, when available. */
  messageId: string | null;
  /** In-Reply-To header — should match a stored outbound messageId. */
  inReplyTo: string | null;
  receivedAt: Date;
}

/** Phase 2 contract: poll one user's mailbox for HR replies since `since`. */
export interface ReplyDetectionProvider {
  readonly name: string;
  fetchReplies(user: IUser, since: Date): Promise<DetectedReply[]>;
}

/**
 * Gmail reply detector (needs the gmail.readonly grant). One search per user:
 * mail FROM any of their open applications' recruiter addresses since the last
 * check, then the From / Message-ID / In-Reply-To headers of each hit.
 */
export class GmailReplyDetector implements ReplyDetectionProvider {
  readonly name = 'gmail-api';

  async fetchReplies(user: IUser, since: Date, fromEmails: string[] = []): Promise<DetectedReply[]> {
    const enc = user.gmailAuth?.refreshTokenEnc;
    if (!enc || fromEmails.length === 0) return [];
    const auth = createOAuthClient();
    auth.setCredentials({ refresh_token: decrypt(enc) });
    const gmail = google.gmail({ version: 'v1', auth });
    const after = Math.floor(since.getTime() / 1000) - 60;
    const replies: DetectedReply[] = [];
    // Gmail search is length-limited; chunk the address list.
    for (let i = 0; i < fromEmails.length; i += 20) {
      const chunk = fromEmails.slice(i, i + 20);
      const q = `from:(${chunk.join(' OR ')}) after:${after} -in:sent -in:chats`;
      const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
      for (const m of list.data.messages ?? []) {
        if (!m.id) continue;
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Message-ID', 'In-Reply-To', 'Date'],
        });
        const h = (name: string) =>
          msg.data.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
        const from = h('From') ?? '';
        const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
        replies.push({
          fromEmail: email,
          messageId: h('Message-ID'),
          inReplyTo: h('In-Reply-To'),
          receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(),
        });
      }
    }
    return replies;
  }

  /**
   * Delivery-failure notices (mailer-daemon / postmaster) since `since`.
   * The failed address comes from Gmail's X-Failed-Recipients header, else it
   * is read out of the bounce snippet and matched against `candidates`.
   */
  async fetchBounces(user: IUser, since: Date, candidates: string[]): Promise<Array<{ failedEmail: string; receivedAt: Date; reason: string }>> {
    const enc = user.gmailAuth?.refreshTokenEnc;
    if (!enc || candidates.length === 0) return [];
    const auth = createOAuthClient();
    auth.setCredentials({ refresh_token: decrypt(enc) });
    const gmail = google.gmail({ version: 'v1', auth });
    const after = Math.floor(since.getTime() / 1000) - 60;
    const q = `from:(mailer-daemon OR postmaster) after:${after}`;
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 30 });
    const wanted = new Set(candidates.map((c) => c.toLowerCase()));
    const out: Array<{ failedEmail: string; receivedAt: Date; reason: string }> = [];
    for (const m of list.data.messages ?? []) {
      if (!m.id) continue;
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['X-Failed-Recipients', 'Subject'],
      });
      const header = msg.data.payload?.headers?.find((x) => x.name?.toLowerCase() === 'x-failed-recipients')?.value ?? '';
      const text = `${header} ${msg.data.snippet ?? ''}`.toLowerCase();
      const found = [...new Set(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [])].filter((e) => wanted.has(e));
      const reason = (msg.data.snippet ?? '').replace(/\s+/g, ' ').slice(0, 200);
      for (const failedEmail of found) {
        out.push({ failedEmail, receivedAt: msg.data.internalDate ? new Date(Number(msg.data.internalDate)) : new Date(), reason });
      }
    }
    return out;
  }
}

/** @deprecated kept for tests/back-compat — the real detector is GmailReplyDetector. */
export class GmailHistoryReplyDetector implements ReplyDetectionProvider {
  readonly name = 'gmail-history-stub';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchReplies(_user: IUser, _since: Date): Promise<DetectedReply[]> {
    return [];
  }
}

/**
 * Match a detected reply to an application (by user + HR email) and apply the
 * shared reply bookkeeping (repliedAt, stage advance, event, follow-up
 * cancellation, template stats). Idempotent via markLatestEmailReplied.
 */
export async function applyDetectedReply(
  userId: string,
  reply: DetectedReply,
  providerName: string,
): Promise<boolean> {
  const application = await Application.findOne({
    userId,
    hrEmail: reply.fromEmail.trim().toLowerCase(),
  });
  if (!application) return false;
  return markLatestEmailReplied(application, {
    manual: false,
    source: providerName,
    ...(reply.messageId ? { messageId: reply.messageId } : {}),
  });
}

/**
 * Check one user's inbox for recruiter replies and apply them: repliedAt,
 * stage applied → HR screen, follow-ups cancelled, "Reply received"
 * notification. Returns how many applications changed.
 */
export async function checkRepliesForUser(userId: string): Promise<{ checked: number; newReplies: number; newBounces: number; enabled: boolean }> {
  const user = await User.findById(userId).select('+gmailAuth.refreshTokenEnc');
  if (!user?.gmailAuth?.canReadReplies || !user.gmailAuth.refreshTokenEnc || user.gmailAuth.needsReconnect) {
    return { checked: 0, newReplies: 0, newBounces: 0, enabled: false };
  }
  const open = await Application.find({
    userId,
    stage: { $in: ['applied', 'hr_screen', 'interview'] },
    'emails.sentAt': { $ne: null },
  }).select('hrEmail emails.sentAt emails.repliedAt emails.bouncedAt company');
  const waiting = open.filter((a) => a.hrEmail && !a.emails.some((e) => e.repliedAt || e.bouncedAt));
  if (waiting.length === 0) return { checked: 0, newReplies: 0, newBounces: 0, enabled: true };

  const firstSent = Math.min(...waiting.flatMap((a) => a.emails.filter((e) => e.sentAt).map((e) => e.sentAt!.getTime())));
  const since = new Date(Math.max(firstSent, user.gmailAuth.repliesCheckedAt ? user.gmailAuth.repliesCheckedAt.getTime() - 60 * 60 * 1000 : 0));
  const detector = new GmailReplyDetector();
  const emails = [...new Set(waiting.map((a) => a.hrEmail!.toLowerCase()))];
  const replies = await detector.fetchReplies(user, since, emails);

  let newReplies = 0;
  for (const reply of replies) {
    const app = waiting.find((a) => a.hrEmail!.toLowerCase() === reply.fromEmail);
    const sentAt = app?.emails.find((e) => e.sentAt)?.sentAt;
    if (!app || !sentAt || reply.receivedAt < sentAt) continue;
    if (await applyDetectedReply(userId, reply, detector.name)) {
      newReplies += 1;
      void createNotification({
        userId: user._id,
        kind: 'reply',
        applicationId: app._id,
        title: 'Reply received',
        body: `${app.company ?? 'The company'} replied to your application.`,
      });
    }
  }
  // Bounces: the address didn't exist / mailbox full / domain rejected.
  let newBounces = 0;
  const bounces = await detector.fetchBounces(user, since, emails);
  for (const b of bounces) {
    const app = waiting.find((a) => a.hrEmail!.toLowerCase() === b.failedEmail);
    const full = app ? await Application.findById(app._id) : null;
    if (!full) continue;
    let idx = -1;
    for (let i = full.emails.length - 1; i >= 0; i -= 1) {
      if (full.emails[i].sentAt && full.emails[i].sentAt! <= b.receivedAt) { idx = i; break; }
    }
    if (idx < 0 || full.emails[idx].bouncedAt || full.emails[idx].repliedAt) continue;
    await recordBounce(full, idx, { detectedFrom: 'mailer-daemon' });
    await stopFollowUpSequence(String(full._id));
    newBounces += 1;
    void createNotification({
      userId: user._id,
      kind: 'bounce',
      applicationId: full._id,
      title: 'Email bounced',
      body: `${full.company ?? 'The company'}: ${full.hrEmail} doesn't accept mail. Find another address and resend.`,
    });
  }

  await User.updateOne({ _id: userId }, { $set: { 'gmailAuth.repliesCheckedAt': new Date() } });
  return { checked: waiting.length, newReplies, newBounces, enabled: true };
}

/** The `poll-replies` Agenda processor (every 5 minutes): every user who granted reply access. */
export async function processPollReplies(): Promise<void> {
  const users = await User.find({ 'gmailAuth.canReadReplies': true, 'gmailAuth.needsReconnect': { $ne: true } }).select('_id');
  let total = 0;
  for (const u of users) {
    try {
      total += (await checkRepliesForUser(String(u._id))).newReplies;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), userId: String(u._id) }, 'poll-replies: user check failed');
    }
  }
  if (total > 0) logger.info({ total }, 'poll-replies: new recruiter replies recorded');
}
