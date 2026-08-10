import { Agenda, type Job } from 'agenda';
import { MongoBackend, type Db } from '@agendajs/mongo-backend';
import mongoose from 'mongoose';
import { Application } from '../models/Application';
import { User } from '../models/User';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { computeSendTime, HOURLY_SEND_CAP } from './jobs/schedule';
import {
  MAX_SEND_ATTEMPTS,
  processSendEmail,
  recordSendError,
  type SendEmailJobData,
} from './jobs/sendEmail';
import {
  markPendingFollowUpsCancelled,
  persistFollowUpSubdocs,
  processMarkGhosted,
  processSendFollowUp,
  type SendFollowUpJobData,
} from './jobs/followups';
import {
  processInterviewReminder,
  type InterviewReminderJobData,
} from './jobs/interviewReminder';
import { processPollReplies } from './replyDetection';
import { processGmailHealthCheck } from './gmail/healthCheck';

/**
 * Agenda-backed send queue (SPEC §5 — MongoDB only, no Redis).
 *
 * QUEUE_INLINE=true (tests, local debugging) bypasses Agenda entirely and
 * processes due jobs synchronously in-process — scheduleSendEmail stays the
 * only entry point so callers never branch on the mode. Future-dated work
 * (follow-ups at day 3/7) can't run inline: in QUEUE_INLINE mode only the
 * pending email subdocs are persisted, and tests/dev invoke the processors
 * (processSendFollowUp, processMarkGhosted) directly.
 *
 * NOTE: Agenda v6 uses a backend abstraction. We use @agendajs/mongo-backend
 * with Mongoose's native Db handle so the driver matches Mongoose 8's mongodb
 * driver 6.x (Agenda 5's bundled mongodb@4 driver caused scheduled jobs to
 * never be picked up in this stack).
 */

const SEND_EMAIL_JOB = 'send-email';
const SEND_FOLLOWUP_JOB = 'send-followup';
const MARK_GHOSTED_JOB = 'mark-ghosted';
const POLL_REPLIES_JOB = 'poll-replies';
const INTERVIEW_REMINDER_JOB = 'interview-reminder';
const GMAIL_HEALTH_JOB = 'gmail-health-check';

/** Reminder emails go out this long before the interview (Phase 3). */
export const INTERVIEW_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

let agenda: Agenda | null = null;

/** Retry backoff for transient send failures: 15m, 30m, 60m. */
function retryDelayMs(attempt: number): number {
  return 15 * 60 * 1000 * Math.pow(2, attempt - 1);
}

async function handleJob(data: SendEmailJobData): Promise<void> {
  logger.info({ jobPostId: data.jobPostId, attempts: data.attempts }, 'send-email job starting');
  try {
    const outcome = await processSendEmail(data);
    if (outcome.status === 'sent') {
      logger.info({ jobPostId: data.jobPostId, applicationId: outcome.applicationId }, 'send-email job succeeded');
      await maybeScheduleFollowUps(outcome.applicationId, data.userId);
    } else if (outcome.status === 'failed') {
      logger.warn({ jobPostId: data.jobPostId }, 'send-email job failed (terminal)');
    } else {
      logger.info({ jobPostId: data.jobPostId }, 'send-email job skipped');
    }
  } catch (err) {
    const attempts = (data.attempts ?? 0) + 1;
    if (agenda && attempts < MAX_SEND_ATTEMPTS) {
      const retryAt = new Date(Date.now() + retryDelayMs(attempts));
      await agenda.schedule(retryAt, SEND_EMAIL_JOB, { ...data, attempts });
      logger.warn(
        { err, jobPostId: data.jobPostId, attempts, retryAt },
        'send-email failed — scheduled retry',
      );
      return;
    }
    // Inline mode or retries exhausted: fail visibly.
    await recordSendError(data, err);
    logger.error({ err, jobPostId: data.jobPostId, attempts }, 'send-email failed permanently');
  }
}

/**
 * The send-followup processor plus the belt-and-braces Agenda cancel: the
 * processor itself re-checks stop conditions and no-ops, and when it stopped
 * (or bounced) the remaining scheduled jobs for the application are removed.
 * Follow-up failures are logged, never retried — a lost nudge must not
 * break anything.
 */
async function handleFollowUpJob(data: SendFollowUpJobData): Promise<void> {
  logger.info({ applicationId: data.applicationId, emailIndex: data.emailIndex }, 'send-followup job starting');
  try {
    const outcome = await processSendFollowUp(data);
    if ((outcome === 'stopped' || outcome === 'bounced') && agenda) {
      await agenda.cancel({ name: SEND_FOLLOWUP_JOB, data: { applicationId: data.applicationId } });
      logger.info({ applicationId: data.applicationId }, 'send-followup sequence cancelled');
    }
  } catch (err) {
    logger.error(
      { err, applicationId: data.applicationId, emailIndex: data.emailIndex },
      'send-followup failed',
    );
  }
}

/**
 * Schedule the day-3/day-7 follow-ups after a successful initial send
 * (SPEC §5), gated on the user's followUpEnabled setting. Persists the
 * pending subdocs first (UI countdown badges, stable pixel indexes), then
 * schedules the Agenda jobs. In QUEUE_INLINE mode only the subdocs are
 * persisted — invoke processSendFollowUp directly to run them.
 */
async function maybeScheduleFollowUps(applicationId: string, userId: string): Promise<void> {
  const user = await User.findById(userId).select('settings name');
  if (!user?.settings.followUpEnabled) {
    logger.info({ applicationId }, 'Follow-ups disabled for user');
    return;
  }

  const plans = await persistFollowUpSubdocs(applicationId, {
    candidateName: user.name,
    tone: user.settings.tone,
  });
  if (!plans) {
    logger.info({ applicationId }, 'No follow-up plans generated');
    return;
  }

  if (agenda) {
    for (const plan of plans) {
      await agenda.schedule(plan.scheduledAt, SEND_FOLLOWUP_JOB, {
        applicationId,
        emailIndex: plan.emailIndex,
      });
    }
    logger.info({ applicationId, count: plans.length }, 'Follow-ups scheduled');
  } else {
    logger.info({ applicationId, count: plans.length }, 'Follow-up subdocs persisted (inline mode — no Agenda)');
  }
}

/**
 * Stop the follow-up sequence for an application (reply, bounce, terminal
 * stage): mark pending subdocs cancelled so they can never send, and remove
 * any scheduled Agenda jobs. Safe to call repeatedly.
 */
export async function stopFollowUpSequence(applicationId: string): Promise<void> {
  await markPendingFollowUpsCancelled(applicationId);
  if (agenda) {
    const removed = await agenda.cancel({ name: SEND_FOLLOWUP_JOB, data: { applicationId } });
    logger.info({ applicationId, removed }, 'stopFollowUpSequence: cancelled scheduled follow-ups');
  }
}

/**
 * Interview reminder scheduling (Phase 3). Cancel + (re)schedule are the only
 * entry points the applications route uses: every interviewAt/stage change
 * first cancels the previously queued job (same unique-identifier pattern as
 * stopFollowUpSequence), then schedules a fresh one when the conditions hold.
 *
 * Returns the reminder time it would fire at, or null when scheduling was
 * skipped because interviewAt − 24h is already in the past. Unlike sends,
 * reminders are future-dated by definition and are NEVER run synchronously in
 * QUEUE_INLINE mode — inline scheduling is a deliberate no-op (tests invoke
 * processInterviewReminder directly), leaving the send path's inline behavior
 * untouched.
 */
export async function scheduleInterviewReminder(
  applicationId: string,
  userId: string,
  interviewAt: Date,
): Promise<{ remindAt: Date } | null> {
  const remindAt = new Date(interviewAt.getTime() - INTERVIEW_REMINDER_LEAD_MS);
  if (remindAt.getTime() <= Date.now()) return null; // < 24h out (or past) — nothing to remind

  if (env.QUEUE_INLINE || !agenda) {
    // Inline mode: no Agenda, and a reminder must not fire during the PATCH.
    return { remindAt };
  }

  const data: InterviewReminderJobData = {
    applicationId,
    userId,
    interviewAt: interviewAt.toISOString(),
  };
  await agenda.schedule(remindAt, INTERVIEW_REMINDER_JOB, data);
  logger.info({ applicationId, remindAt }, 'interview-reminder scheduled');
  return { remindAt };
}

/** Remove any queued interview reminder for an application. Safe to repeat. */
export async function cancelInterviewReminder(applicationId: string): Promise<void> {
  if (agenda) {
    const removed = await agenda.cancel({ name: INTERVIEW_REMINDER_JOB, data: { applicationId } });
    logger.info({ applicationId, removed }, 'cancelInterviewReminder: removed reminders');
  }
}

/**
 * Interview reminders are best-effort: failures are logged and dropped — no
 * retries, and NEVER recorded on User.lastSendError (that flag drives the
 * send-pipeline reconnect banner).
 */
async function handleInterviewReminderJob(data: InterviewReminderJobData): Promise<void> {
  try {
    await processInterviewReminder(data);
  } catch (err) {
    logger.error({ err, applicationId: data.applicationId }, 'interview-reminder failed');
  }
}

/**
 * Remove every scheduled job belonging to a user (account deletion): pending
 * initial sends plus all follow-ups and interview reminders queued for their
 * applications. No-op in QUEUE_INLINE mode (no Agenda, nothing scheduled).
 */
export async function cancelUserJobs(userId: string, applicationIds: string[]): Promise<void> {
  if (!agenda) return;
  const initialRemoved = await agenda.cancel({ name: SEND_EMAIL_JOB, data: { userId } });
  logger.info({ userId, initialRemoved }, 'cancelUserJobs: removed initial sends');
  if (applicationIds.length > 0) {
    for (const applicationId of applicationIds) {
      await agenda.cancel({ name: SEND_FOLLOWUP_JOB, data: { applicationId } });
      await agenda.cancel({ name: INTERVIEW_REMINDER_JOB, data: { applicationId } });
    }
    logger.info({ userId, count: applicationIds.length }, 'cancelUserJobs: removed follow-ups and reminders');
  }
}

/** Start Agenda on the existing Mongoose connection. Call after mongoose.connect. */
export async function initQueue(): Promise<void> {
  if (env.QUEUE_INLINE) {
    logger.info('QUEUE_INLINE=true — send jobs run inline, Agenda disabled');
    return;
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error('initQueue requires an active MongoDB connection');

  agenda = new Agenda({
    // Cast through unknown: Mongoose's mongodb driver version (6.20.x) and
    // @agendajs/mongo-backend's mongodb peer (6.21.x) differ at the type level
    // only — the runtime Db API is identical.
    backend: new MongoBackend({ mongo: db as unknown as Db }),
    processEvery: '30 seconds',
  });

  agenda.define(
    SEND_EMAIL_JOB,
    async (job: Job<SendEmailJobData>) => {
      await handleJob(job.attrs.data);
    },
    { concurrency: 2, lockLifetime: 5 * 60 * 1000 },
  );
  agenda.define(
    SEND_FOLLOWUP_JOB,
    async (job: Job<SendFollowUpJobData>) => {
      await handleFollowUpJob(job.attrs.data);
    },
    { concurrency: 2, lockLifetime: 5 * 60 * 1000 },
  );
  agenda.define(
    INTERVIEW_REMINDER_JOB,
    async (job: Job<InterviewReminderJobData>) => {
      await handleInterviewReminderJob(job.attrs.data);
    },
    { concurrency: 2, lockLifetime: 5 * 60 * 1000 },
  );
  agenda.define(MARK_GHOSTED_JOB, async () => {
    await processMarkGhosted();
  });
  agenda.define(GMAIL_HEALTH_JOB, async () => {
    await processGmailHealthCheck();
  });
  // Phase 2 stub (SPEC §5 reply detection): defined so the job exists, but
  // never scheduled — processPollReplies is a documented no-op until the
  // Gmail history.list poller lands.
  agenda.define(POLL_REPLIES_JOB, async () => {
    await processPollReplies();
  });
  agenda.on('fail', (err: Error, job: Job) => {
    logger.error({ err, jobName: job?.attrs.name }, 'Agenda job failed');
  });

  await agenda.start();
  // Daily sweep: applied + no reply/bounce 14 days after the last sent email → ghosted.
  await agenda.every('1 day', MARK_GHOSTED_JOB);
  // Daily sweep: flag Gmail connections whose grant was revoked/expired at Google
  // so the user is prompted to reconnect before their next campaign (Gap H).
  await agenda.every('1 day', GMAIL_HEALTH_JOB);
  logger.info('Agenda v6 queue started with MongoBackend');
}

/** Queue runtime status for the health endpoint. */
export function getQueueStatus(): { mode: 'inline' | 'agenda'; healthy: boolean } {
  if (env.QUEUE_INLINE) {
    return { mode: 'inline', healthy: true };
  }
  return { mode: 'agenda', healthy: agenda !== null };
}

export async function stopQueue(): Promise<void> {
  if (agenda) {
    await agenda.stop();
    agenda = null;
  }
}

/** Count emails sent by this user since `since` (drives the send caps). */
async function countSendsSince(userId: string, since: Date): Promise<number> {
  return Application.countDocuments({ userId, 'emails.sentAt': { $gte: since } });
}

export interface ScheduleSendResult {
  /** Final send time after jitter + daily/hourly caps (SPEC §5). */
  scheduledAt: Date;
}

/**
 * Enqueue the initial outreach email for a JobPost. Applies 2–8 min jitter,
 * the user's dailySendCap, and the 10/hour cap; overflow lands next day 9–11 AM.
 * In QUEUE_INLINE mode the job runs immediately (scheduledAt is still honored
 * in the persisted record).
 */
export async function scheduleSendEmail(
  jobPostId: string,
  userId: string,
  requestedAt?: Date,
): Promise<ScheduleSendResult> {
  const user = await User.findById(userId).select('settings');
  const dailyCap = user?.settings.dailySendCap ?? 30;

  const now = new Date();
  const base = requestedAt && requestedAt > now ? requestedAt : now;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);

  const [sentToday, sentThisHour] = await Promise.all([
    countSendsSince(userId, dayStart),
    countSendsSince(userId, hourStart),
  ]);

  const scheduledAt = computeSendTime({
    base,
    sentToday,
    sentThisHour,
    dailyCap,
    hourlyCap: HOURLY_SEND_CAP,
  });

  const data: SendEmailJobData = {
    jobPostId,
    userId,
    scheduledAt: scheduledAt.toISOString(),
    attempts: 0,
  };

  if (env.QUEUE_INLINE || !agenda) {
    if (!env.QUEUE_INLINE && !agenda) {
      logger.warn(
        { jobPostId },
        'send-email falling back to inline mode because Agenda is not initialized (Mongo may have been down at startup)',
      );
    } else {
      logger.info({ jobPostId, mode: 'inline' }, 'send-email running inline');
    }
    await handleJob(data);
  } else {
    await agenda.schedule(scheduledAt, SEND_EMAIL_JOB, data);
    logger.info({ jobPostId, scheduledAt }, 'send-email scheduled');
  }

  return { scheduledAt };
}
