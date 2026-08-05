import fs from 'node:fs';
import mongoose from 'mongoose';
import type { SendFailureCode } from '@jobmail/shared';
import { JobPost, type IJobPost } from '../../models/JobPost';
import { Profile } from '../../models/Profile';
import { User } from '../../models/User';
import { Application } from '../../models/Application';
import { EmailEvent } from '../../models/EmailEvent';
import { incrementTemplateStat } from '../../models/EmailTemplate';
import { GmailNotConnectedError, isPermanentSendError, sendMail } from '../mailer';
import { injectTrackingPixel } from '../tracking';
import { hasMxRecord } from '../../utils/emailValidation';
import { logger } from '../../utils/logger';

/**
 * The `send-email` job payload and processor (SPEC §5).
 *
 * Terminal domain failures (bad MX, missing resume, missing draft, permanent
 * SMTP bounce) mark the JobPost failed with a machine-readable failureCode
 * and do NOT throw — the job did its work. Infrastructure failures (Gmail
 * disconnected, transient SMTP errors) throw and are retried by the queue
 * with backoff, then marked failed.
 */

export const MAX_SEND_ATTEMPTS = 3;

export interface SendEmailJobData {
  jobPostId: string;
  userId: string;
  /** ISO timestamp of when this send was scheduled (caps + jitter applied). */
  scheduledAt: string;
  attempts: number;
}

/** Mark a JobPost failed with a UI-keyable reason (SPEC §9). */
export async function failJob(
  jobPostId: string,
  code: SendFailureCode,
  message: string,
): Promise<void> {
  await JobPost.updateOne(
    { _id: jobPostId },
    { $set: { status: 'failed', failureCode: code, error: message } },
  );
  logger.warn({ jobPostId, failureCode: code }, 'Send job marked failed');
}

/**
 * Record a retry-exhausted (or inline-mode) send error: surface it on the
 * user for the reconnect banner and fail the job with a recognizable code.
 */
export async function recordSendError(data: SendEmailJobData, err: unknown): Promise<void> {
  const notConnected = err instanceof GmailNotConnectedError;
  const message = err instanceof Error ? err.message : 'Email send failed';
  await User.updateOne({ _id: data.userId }, { $set: { lastSendError: message } });
  await failJob(
    data.jobPostId,
    notConnected ? 'GMAIL_NOT_CONNECTED' : 'SEND_FAILED',
    notConnected
      ? 'Gmail disconnected — reconnect in Settings, then re-queue this email'
      : 'Email send failed — please try again',
  );
}

/** "Priya Sharma" → Priya_Sharma_Resume.pdf (SPEC §5 attachment rename). */
export function resumeAttachmentName(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean);
  if (parts.length === 0) return 'Resume.pdf';
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return `${[first, last].filter(Boolean).join('_')}_Resume.pdf`;
}

export type SendEmailOutcome =
  | { status: 'sent'; applicationId: string }
  | { status: 'skipped' }
  | { status: 'failed' };

/**
 * Bounce on the initial send (SPEC §5 phase 1, webhook-less): persist the
 * Application with the initial email stamped bouncedAt so the attempt is on
 * record and follow-ups can never be scheduled for it, plus the EmailEvent.
 */
async function recordInitialBounce(
  applicationId: mongoose.Types.ObjectId,
  data: SendEmailJobData,
  job: IJobPost,
  finalHtml: string,
  scheduledAt: Date,
  err: unknown,
): Promise<void> {
  const bouncedAt = new Date();
  const smtp = err as { responseCode?: unknown };
  const meta = {
    emailIndex: 0,
    ...(typeof smtp?.responseCode === 'number' ? { responseCode: smtp.responseCode } : {}),
  };

  const updated = await Application.updateOne(
    { _id: applicationId, 'emails.0.bouncedAt': null },
    { $set: { 'emails.0.bouncedAt': bouncedAt } },
  );
  if (updated.matchedCount === 0) {
    // No Application yet (first attempt) — create one holding the bounced attempt.
    await Application.updateOne(
      { _id: applicationId },
      {
        $setOnInsert: {
          userId: job.userId,
          jobPostId: job._id,
          hrEmail: job.hrEmail,
          hrName: job.extraction?.hrName ?? null,
          company: job.extraction?.company ?? null,
          role: job.extraction?.role ?? null,
          stage: 'applied',
          templateId: job.templateId ?? null,
          emails: [
            {
              subject: job.draft.subject,
              bodyText: job.draft.bodyText,
              bodyHtml: finalHtml,
              kind: 'initial',
              scheduledAt,
              sentAt: null,
              bouncedAt,
              messageId: null,
            },
          ],
        },
      },
      { upsert: true },
    );
  }
  await EmailEvent.create({ applicationId, kind: 'bounce', meta });
  logger.warn({ jobPostId: data.jobPostId }, 'Initial outreach bounced (permanent SMTP error)');
}

/**
 * Send the queued initial outreach email for one JobPost.
 * Idempotent: already-sent jobs (or existing Applications) are skipped.
 */
export async function processSendEmail(data: SendEmailJobData): Promise<SendEmailOutcome> {
  const job = await JobPost.findById(data.jobPostId);
  if (!job || String(job.userId) !== data.userId) {
    logger.warn({ jobPostId: data.jobPostId }, 'send-email: JobPost not found — dropping job');
    return { status: 'skipped' };
  }
  if (job.status === 'sent') return { status: 'skipped' };
  if (job.status !== 'queued') {
    logger.warn({ jobPostId: data.jobPostId, status: job.status }, 'send-email: job not queued — skipping');
    return { status: 'skipped' };
  }

  // ── Terminal guard 1: draft + recipient must exist (route validates, but
  //    the job may run long after enqueue) ──
  if (!job.hrEmail || !job.draft.subject || !job.draft.bodyText) {
    await failJob(data.jobPostId, 'SEND_FAILED', 'Missing HR email or draft — regenerate the email and re-queue');
    return { status: 'failed' };
  }

  // ── Terminal guard 2: MX check on the recipient domain (SPEC §5) ──
  const domain = job.hrEmail.split('@')[1];
  if (!(await hasMxRecord(domain))) {
    await failJob(
      data.jobPostId,
      'MX_INVALID_DOMAIN',
      `No mail server found for domain "${domain}" — fix the HR email and re-queue`,
    );
    return { status: 'failed' };
  }

  // ── Terminal guard 3: resume must be attached (SPEC §9 edge case 9) ──
  const profile = await Profile.findOne({ userId: data.userId });
  const resume = profile?.resumeFile ?? null;
  if (!resume?.path || !fs.existsSync(resume.path)) {
    await failJob(
      data.jobPostId,
      'RESUME_MISSING',
      'Upload your resume in Profile before sending — it is attached to every outreach email',
    );
    return { status: 'failed' };
  }

  // ── Compose the final HTML (M4 tracking pixel) ──
  // The pixel URL embeds the Application id + email index, so the id is
  // generated up front and the Application is persisted with it after a
  // successful send. Idempotent retry: an existing Application keeps its id.
  const existing = await Application.findOne({ jobPostId: job._id });
  const applicationId = existing?._id ?? new mongoose.Types.ObjectId();
  const emailIndex = 0; // initial outreach; follow-ups (M5) append at 1/2
  const finalHtml = injectTrackingPixel(job.draft.bodyHtml, String(applicationId), emailIndex);

  // ── Send (throws on infrastructure failures → queue retries) ──
  let messageId: string;
  try {
    ({ messageId } = await sendMail({
      userId: data.userId,
      to: job.hrEmail,
      subject: job.draft.subject,
      text: job.draft.bodyText,
      html: finalHtml,
      attachments: [
        { filename: resumeAttachmentName(profile!.fullName), path: resume.path },
      ],
    }));
  } catch (err) {
    // Permanent recipient/SMTP failure = bounce (SPEC §9.7): terminal, no
    // retry. Record it and fail the job with an actionable message.
    if (isPermanentSendError(err)) {
      await recordInitialBounce(applicationId, data, job, finalHtml, new Date(data.scheduledAt), err);
      await failJob(
        data.jobPostId,
        'SEND_FAILED',
        'The recipient server rejected this email (bounce) — check the HR address and re-queue',
      );
      return { status: 'failed' };
    }
    if (err instanceof GmailNotConnectedError) {
      await User.updateOne({ _id: data.userId }, { $set: { lastSendError: err.message } });
    }
    throw err;
  }

  // ── Persist: Application (stage applied) + JobPost sent ──
  const sentAt = new Date();
  const scheduledAt = new Date(data.scheduledAt);
  if (!existing) {
    await Application.create({
      _id: applicationId,
      userId: job.userId,
      jobPostId: job._id,
      hrEmail: job.hrEmail,
      hrName: job.extraction?.hrName ?? null,
      company: job.extraction?.company ?? null,
      role: job.extraction?.role ?? null,
      stage: 'applied',
      templateId: job.templateId ?? null,
      emails: [
        {
          subject: job.draft.subject,
          bodyText: job.draft.bodyText,
          bodyHtml: finalHtml,
          kind: 'initial',
          scheduledAt,
          sentAt,
          messageId,
        },
      ],
    });
  } else {
    // Retry after a bounce: the Application already exists with a failed first
    // email. Overwrite it with the successful send so follow-ups can schedule.
    const initial = existing.emails[0];
    if (initial) {
      initial.subject = job.draft.subject;
      initial.bodyText = job.draft.bodyText;
      initial.bodyHtml = finalHtml;
      initial.scheduledAt = scheduledAt;
      initial.sentAt = sentAt;
      initial.bouncedAt = null;
      initial.messageId = messageId;
    }
    existing.hrEmail = job.hrEmail;
    existing.hrName = job.extraction?.hrName ?? existing.hrName;
    existing.company = job.extraction?.company ?? existing.company;
    existing.role = job.extraction?.role ?? existing.role;
    existing.templateId = job.templateId ?? existing.templateId;
    await existing.save();
  }
  // Per-template A/B stats: the templated email actually went out (SPEC §6).
  await incrementTemplateStat(job.templateId, 'sent');

  job.status = 'sent';
  job.error = null;
  job.failureCode = null;
  await job.save();
  // A successful send clears any stale mid-queue error banner.
  await User.updateOne({ _id: data.userId, lastSendError: { $ne: null } }, { $set: { lastSendError: null } });

  logger.info({ jobPostId: data.jobPostId, messageId }, 'Outreach email sent');
  return { status: 'sent', applicationId: String(applicationId) };
}
