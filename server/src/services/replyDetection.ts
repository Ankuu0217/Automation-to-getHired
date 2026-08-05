import { Application } from '../models/Application';
import type { IUser } from '../models/User';
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
 * STUB — returns no replies until the Gmail history.list poller is built.
 * Keeping it a class preserves the swap-in point for the real provider.
 */
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
 * The `poll-replies` Agenda processor. PHASE 2: no-op by design — the job is
 * defined in queue.ts so the wiring is in place, but never scheduled. Enable
 * by scheduling `agenda.every('5 minutes', 'poll-replies')` once
 * GmailHistoryReplyDetector is implemented.
 */
export async function processPollReplies(): Promise<void> {
  logger.debug('poll-replies: phase 2 stub — reply detection not enabled');
}
