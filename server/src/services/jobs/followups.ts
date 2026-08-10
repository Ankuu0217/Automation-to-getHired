import type { ApplicationStage, Tone } from '@jobmail/shared';
import { Application, type IApplication, type IApplicationEmail } from '../../models/Application';
import { EmailEvent } from '../../models/EmailEvent';
import { User } from '../../models/User';
import { isPermanentSendError, sendMail } from '../mailer';
import { injectTrackingPixel } from '../tracking';
import { countWords, emailBodyToHtml } from '../emailRules';
import { logger } from '../../utils/logger';

/**
 * Follow-up automation (SPEC §5, M5).
 *
 * Pure section (no DB/Agenda imports below the line — mirrors jobs/schedule.ts
 * so delays, stop conditions and the ghosted cutoff unit-test in isolation):
 *  - computeFollowUpSchedule: day 3 / day 7 after the initial send.
 *  - buildFollowUpBody: deterministic ≤60-word nudge (AI generation is
 *    deliberately not used here — follow-ups must be cheap and reliable).
 *  - followUpStopReason: reply / bounce / terminal stage stop conditions.
 *  - isGhostable: applied + no reply/bounce 14 days after the last sent email.
 *
 * Impure section: the subdoc persistence + job processors. Agenda wiring
 * (schedule/cancel, recurring registration) lives in services/queue.ts,
 * which is the only module that touches the Agenda instance.
 */

export const FOLLOWUP_1_DELAY_DAYS = 3;
export const FOLLOWUP_2_DELAY_DAYS = 7;
export const GHOST_AFTER_DAYS = 14;
export const MAX_FOLLOWUP_WORDS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowUpPlan {
  kind: 'followup_1' | 'followup_2';
  /** Index into Application.emails (0 is the initial outreach). */
  emailIndex: number;
  scheduledAt: Date;
}

/** Day 3 and day 7 after the initial email was sent (same time of day). */
export function computeFollowUpSchedule(sentAt: Date): FollowUpPlan[] {
  return [
    {
      kind: 'followup_1',
      emailIndex: 1,
      scheduledAt: new Date(sentAt.getTime() + FOLLOWUP_1_DELAY_DAYS * DAY_MS),
    },
    {
      kind: 'followup_2',
      emailIndex: 2,
      scheduledAt: new Date(sentAt.getTime() + FOLLOWUP_2_DELAY_DAYS * DAY_MS),
    },
  ];
}

export interface FollowUpBodyInput {
  hrName: string | null;
  role: string | null;
  company: string | null;
  candidateName: string;
  /** 1 = day-3 nudge, 2 = day-7 final nudge. */
  sequence: 1 | 2;
  tone: Tone;
}

/**
 * Short polite nudge (SPEC §5: ≤ 60 words), parameterized by name/role/
 * company. Deterministic — no model call, matches the fallback style of
 * services/ai/outreach.ts.
 */
export function buildFollowUpBody(input: FollowUpBodyInput): string {
  const firstName = input.hrName?.trim().split(/\s+/)[0];
  const greeting =
    input.tone === 'formal'
      ? `Dear ${input.hrName ?? 'Hiring Manager'},`
      : `Hi ${firstName ?? 'there'},`;
  const signOff = input.tone === 'formal' ? 'Best regards,' : input.tone === 'friendly' ? 'Cheers,' : 'Best,';
  const rolePhrase = input.role ? `the ${input.role} role` : 'the role';
  const companyPhrase = input.company ? ` at ${input.company}` : '';

  const nudge =
    input.sequence === 1
      ? `Just following up on my application for ${rolePhrase}${companyPhrase} — I'm still very interested and glad to share anything else that would help. My resume is attached to my first email.`
      : `One last note on my application for ${rolePhrase}${companyPhrase}. If the timing isn't right, no worries — I'd still welcome a short chat whenever suits. Thank you for your time.`;

  return [greeting, nudge, `${signOff}\n${input.candidateName}`].join('\n\n');
}

/** Minimal shape the stop-condition check needs (works on lean docs). */
export interface FollowUpStopSnapshot {
  stage: ApplicationStage;
  emails: Array<Pick<IApplicationEmail, 'repliedAt' | 'bouncedAt'>>;
}

export type FollowUpStopReason = 'replied' | 'bounced' | 'stage_closed';

/**
 * Stop conditions (SPEC §5), checked at job execution time: any reply or
 * bounce on the thread, or a terminal stage (rejected/offer). null = send.
 */
export function followUpStopReason(app: FollowUpStopSnapshot): FollowUpStopReason | null {
  if (app.emails.some((e) => e.repliedAt)) return 'replied';
  if (app.emails.some((e) => e.bouncedAt)) return 'bounced';
  if (app.stage === 'rejected' || app.stage === 'offer') return 'stage_closed';
  return null;
}

/** Latest sent timestamp across the thread; null when nothing went out. */
export function lastSentAt(
  emails: Array<Pick<IApplicationEmail, 'sentAt'>>,
): Date | null {
  let last: Date | null = null;
  for (const e of emails) {
    if (e.sentAt && (!last || e.sentAt > last)) last = e.sentAt;
  }
  return last;
}

/**
 * Ghosted rule (SPEC §9.7): still in `applied`, no reply or bounce anywhere
 * on the thread, and the last sent email is at least GHOST_AFTER_DAYS old.
 */
export function isGhostable(
  app: {
    stage: ApplicationStage;
    emails: Array<Pick<IApplicationEmail, 'sentAt' | 'repliedAt' | 'bouncedAt'>>;
  },
  now: Date,
): boolean {
  if (app.stage !== 'applied') return false;
  if (app.emails.some((e) => e.repliedAt || e.bouncedAt)) return false;
  const last = lastSentAt(app.emails);
  if (!last) return false;
  return now.getTime() - last.getTime() >= GHOST_AFTER_DAYS * DAY_MS;
}

/* ── Impure section: persistence + job processors ───────────────────── */

/** Payload of the `send-followup` Agenda job. */
export interface SendFollowUpJobData {
  applicationId: string;
  emailIndex: number;
}

export type FollowUpOutcome = 'sent' | 'skipped' | 'stopped' | 'bounced';

/**
 * Persist the pending follow-up subdocs (indexes 1/2) at schedule time so the
 * UI can show countdown badges and the tracking-pixel index is stable.
 * Idempotent: returns null when follow-ups already exist or the initial
 * email hasn't been sent. Agenda scheduling on top of this lives in queue.ts.
 */
export async function persistFollowUpSubdocs(
  applicationId: string,
  input: { candidateName: string; tone: Tone },
): Promise<FollowUpPlan[] | null> {
  const application = await Application.findById(applicationId);
  if (!application) return null;
  const initial = application.emails[0];
  if (!initial?.sentAt) return null;
  if (application.emails.some((e) => e.kind !== 'initial')) return null;

  const plans = computeFollowUpSchedule(initial.sentAt);
  for (const plan of plans) {
    application.emails.push({
      subject: `Re: ${initial.subject}`,
      bodyText: buildFollowUpBody({
        hrName: application.hrName,
        role: application.role,
        company: application.company,
        candidateName: input.candidateName,
        tone: input.tone,
        sequence: plan.emailIndex === 1 ? 1 : 2,
      }),
      bodyHtml: '',
      kind: plan.kind,
      scheduledAt: plan.scheduledAt,
      sentAt: null,
      openedAt: null,
      repliedAt: null,
      bouncedAt: null,
      messageId: null,
      cancelledAt: null,
    });
  }
  await application.save();
  return plans;
}

/**
 * Mark every unsent follow-up subdoc cancelled so it can never send (the job
 * processor also re-checks stop conditions before sending). Returns the
 * number of subdocs marked.
 */
export async function markPendingFollowUpsCancelled(applicationId: string): Promise<number> {
  const res = await Application.updateOne(
    { _id: applicationId },
    { $set: { 'emails.$[f].cancelledAt': new Date() } },
    {
      arrayFilters: [
        {
          'f.kind': { $in: ['followup_1', 'followup_2'] },
          'f.sentAt': null,
          'f.cancelledAt': null,
        },
      ],
    },
  );
  return res.modifiedCount;
}

/**
 * Bounce bookkeeping (SPEC §5/§9.7): stamp bouncedAt (first bounce wins),
 * record the EmailEvent, cancel pending follow-up subdocs. Meta holds SMTP
 * metadata only — never message content.
 */
export async function recordBounce(
  application: IApplication,
  emailIndex: number,
  err: unknown,
): Promise<void> {
  const email = application.emails[emailIndex];
  if (email && !email.bouncedAt) {
    email.bouncedAt = new Date();
    await application.save();
  }
  const smtp = err as { responseCode?: unknown };
  await EmailEvent.create({
    applicationId: application._id,
    kind: 'bounce',
    meta: {
      emailIndex,
      ...(typeof smtp?.responseCode === 'number' ? { responseCode: smtp.responseCode } : {}),
    },
  });
  await markPendingFollowUpsCancelled(String(application._id));
  logger.warn(
    { applicationId: String(application._id), emailIndex },
    'Email bounced — follow-up sequence cancelled',
  );
}

/**
 * The `send-followup` job processor. Re-checks the stop conditions at
 * execution time (not just schedule time): on reply/bounce/terminal stage it
 * cancels the remaining subdocs and no-ops. Threading: In-Reply-To points at
 * the initial messageId; References chains every prior sent messageId.
 */
export async function processSendFollowUp(data: SendFollowUpJobData): Promise<FollowUpOutcome> {
  const application = await Application.findById(data.applicationId);
  if (!application) {
    logger.warn({ applicationId: data.applicationId }, 'send-followup: application gone — dropping job');
    return 'skipped';
  }
  const email = application.emails[data.emailIndex];
  if (!email || email.kind === 'initial') {
    logger.warn(
      { applicationId: data.applicationId, emailIndex: data.emailIndex },
      'send-followup: no follow-up subdoc at index — dropping job',
    );
    return 'skipped';
  }
  if (email.sentAt || email.cancelledAt) return 'skipped';

  const stop = followUpStopReason(application);
  if (stop) {
    await markPendingFollowUpsCancelled(String(application._id));
    logger.info(
      { applicationId: data.applicationId, reason: stop },
      'Follow-up sequence stopped before send',
    );
    return 'stopped';
  }

  // ── Sending gate (defense in depth): follow-ups are outreach too, so never
  //    send on behalf of an unverified account. This should be unreachable —
  //    a follow-up only exists after a verified initial send, and verification
  //    is permanent — but we re-check right before the send regardless. ──
  const owner = await User.findById(application.userId).select('emailVerified');
  if (!owner?.emailVerified) {
    logger.warn(
      { applicationId: data.applicationId, userId: String(application.userId) },
      'send-followup: owner not email-verified — skipping outreach',
    );
    return 'skipped';
  }

  const initial = application.emails[0];
  const references = application.emails
    .filter((e) => e.sentAt && e.messageId)
    .map((e) => e.messageId as string);
  const html = injectTrackingPixel(
    emailBodyToHtml(email.bodyText),
    String(application._id),
    data.emailIndex,
  );

  try {
    const { messageId } = await sendMail({
      userId: String(application.userId),
      to: application.hrEmail,
      subject: email.subject,
      text: email.bodyText,
      html,
      ...(initial?.messageId ? { inReplyTo: initial.messageId } : {}),
      ...(references.length > 0 ? { references: references.join(' ') } : {}),
    });
    email.messageId = messageId;
    email.sentAt = new Date();
    email.bodyHtml = html;
    await application.save();
    logger.info(
      { applicationId: data.applicationId, emailIndex: data.emailIndex, messageId },
      'Follow-up email sent',
    );
    return 'sent';
  } catch (err) {
    if (isPermanentSendError(err)) {
      await recordBounce(application, data.emailIndex, err);
      return 'bounced';
    }
    throw err; // transient — the queue handler logs; follow-ups are not retried
  }
}

/**
 * The `mark-ghosted` daily job processor: sweep applied applications and move
 * the ghostable ones to stage `ghosted`. Returns how many were marked.
 */
export async function processMarkGhosted(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - GHOST_AFTER_DAYS * DAY_MS);
  const candidates = await Application.find({
    stage: 'applied',
    'emails.sentAt': { $lte: cutoff },
  });
  let marked = 0;
  for (const application of candidates) {
    if (!isGhostable(application, now)) continue;
    application.stage = 'ghosted';
    await application.save();
    marked += 1;
  }
  if (marked > 0) logger.info({ marked }, 'Applications marked ghosted');
  return marked;
}

/** Exported for tests: the ≤60-word guarantee the templates must keep. */
export function followUpBodyWordCount(input: FollowUpBodyInput): number {
  return countWords(buildFollowUpBody(input));
}
