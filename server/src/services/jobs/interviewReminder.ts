import { Application } from '../../models/Application';
import { User } from '../../models/User';
import { GmailNotConnectedError, sendMail } from '../mailer';
import { emailBodyToHtml } from '../emailRules';
import { logger } from '../../utils/logger';

/**
 * Interview reminder (Phase 3): a best-effort email to the USER'S OWN address
 * 24h before an interview scheduled in the pipeline drawer. Agenda wiring
 * (schedule/cancel/define) lives in services/queue.ts — this module is only
 * the job processor, mirroring the sendEmail.ts / followups.ts split.
 *
 * Reminders never touch the send pipeline: failures are logged and dropped
 * (no retries) and MUST NOT set User.lastSendError — that flag drives the
 * send-pipeline reconnect banner, and a missed reminder is not a send outage.
 */

/** Payload of the `interview-reminder` Agenda job. */
export interface InterviewReminderJobData {
  applicationId: string;
  userId: string;
  /** ISO snapshot of interviewAt at schedule time — the job no-ops if it moved. */
  interviewAt: string;
}

export type InterviewReminderOutcome = 'sent' | 'skipped';

/** Tolerance when comparing the stored interviewAt to the scheduled snapshot. */
const INTERVIEW_SNAPSHOT_TOLERANCE_MS = 60 * 1000;

function formatInterviewTime(at: Date): string {
  return at.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The `interview-reminder` job processor. Guards re-checked at execution time:
 * application still exists, stage is still `interview`, interviewAt is
 * unchanged since scheduling, and the interview hasn't already happened.
 */
export async function processInterviewReminder(
  data: InterviewReminderJobData,
): Promise<InterviewReminderOutcome> {
  const application = await Application.findById(data.applicationId);
  if (!application || application.stage !== 'interview' || !application.interviewAt) {
    return 'skipped';
  }

  const interviewAt = application.interviewAt;
  const snapshot = new Date(data.interviewAt).getTime();
  if (Math.abs(interviewAt.getTime() - snapshot) > INTERVIEW_SNAPSHOT_TOLERANCE_MS) {
    // Rescheduled since this job was queued — the PATCH queued a fresh job.
    return 'skipped';
  }
  if (interviewAt.getTime() <= Date.now()) return 'skipped';

  const user = await User.findById(application.userId).select('email name');
  if (!user) return 'skipped';

  const company = application.company ?? 'the company';
  const subject = `Interview with ${company} tomorrow`;
  const lines: string[] = [`Your interview with ${company} is coming up.`];
  if (application.role) lines.push(`Role: ${application.role}`);
  lines.push(`Time: ${formatInterviewTime(interviewAt)}`);
  if (application.interviewNote) lines.push(`Note: ${application.interviewNote}`);
  lines.push('Good luck!');
  const text = lines.join('\n\n');

  try {
    await sendMail({
      userId: String(application.userId),
      to: user.email,
      subject,
      text,
      html: emailBodyToHtml(text),
    });
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      // Best-effort: no transport, no reminder. Do NOT record lastSendError.
      logger.warn(
        { applicationId: data.applicationId },
        'interview-reminder skipped — Gmail not connected',
      );
      return 'skipped';
    }
    throw err; // transient — the queue handler logs; reminders are never retried
  }

  // Phase 7 will also emit a Notification here.
  logger.info({ applicationId: data.applicationId }, 'Interview reminder sent');
  return 'sent';
}
