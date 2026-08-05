import { Router } from 'express';
import mongoose from 'mongoose';
import {
  applicationUpdateSchema,
  ErrorCodes,
  type ApplicationDetailResponse,
  type ApplicationEmailKind,
  type ApplicationEventResponse,
  type ApplicationListResponse,
  type ApplicationSummary,
  type ApplicationUpdateInput,
  type MarkRepliedResponse,
} from '@jobmail/shared';
import { Application, type IApplication, type IApplicationEmail } from '../models/Application';
import { EmailEvent, type IEmailEvent } from '../models/EmailEvent';
import { AppError } from '../middleware/error';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { markLatestEmailReplied } from '../services/replies';
import {
  cancelInterviewReminder,
  scheduleInterviewReminder,
  stopFollowUpSequence,
} from '../services/queue';

/**
 * Applications API (SPEC §6) — Kanban data for the pipeline board plus the
 * detail thread with its tracking-event timeline (M4).
 */
export const applicationsRouter = Router();

applicationsRouter.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function emailDto(email: IApplicationEmail) {
  return {
    subject: email.subject,
    bodyText: email.bodyText,
    bodyHtml: email.bodyHtml,
    kind: email.kind,
    scheduledAt: iso(email.scheduledAt),
    sentAt: iso(email.sentAt),
    openedAt: iso(email.openedAt),
    repliedAt: iso(email.repliedAt),
    bouncedAt: iso(email.bouncedAt),
    messageId: email.messageId,
    cancelledAt: iso(email.cancelledAt),
  };
}

function eventDto(event: IEmailEvent): ApplicationEventResponse {
  return {
    kind: event.kind,
    meta: (event.meta ?? {}) as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  };
}

function toDetail(app: IApplication, events: IEmailEvent[]): ApplicationDetailResponse {
  return {
    id: String(app._id),
    jobPostId: String(app.jobPostId),
    hrEmail: app.hrEmail,
    hrName: app.hrName,
    company: app.company,
    role: app.role,
    stage: app.stage,
    emails: app.emails.map(emailDto),
    notes: app.notes,
    events: events.map(eventDto),
    interviewAt: iso(app.interviewAt),
    interviewNote: app.interviewNote,
    createdAt: app.createdAt.toISOString(),
  };
}

function toSummary(app: IApplication): ApplicationSummary {
  // Latest SENT email — pending follow-up subdocs (M5) trail the thread and
  // must not hide the real last-contact timestamp on Kanban cards.
  let last: IApplicationEmail | null = null;
  for (let i = app.emails.length - 1; i >= 0; i -= 1) {
    if (app.emails[i].sentAt) {
      last = app.emails[i];
      break;
    }
  }
  return {
    id: String(app._id),
    company: app.company,
    role: app.role,
    hrName: app.hrName,
    hrEmail: app.hrEmail,
    stage: app.stage,
    daysSinceSent: last?.sentAt
      ? Math.max(0, Math.floor((Date.now() - last.sentAt.getTime()) / DAY_MS))
      : null,
    nextFollowUpAt: nextFollowUpAt(app),
    interviewAt: iso(app.interviewAt),
    interviewNote: app.interviewNote,
    lastEmail: last
      ? {
          kind: last.kind as ApplicationEmailKind,
          sentAt: iso(last.sentAt),
          openedAt: iso(last.openedAt),
          repliedAt: iso(last.repliedAt),
          bouncedAt: iso(last.bouncedAt),
        }
      : null,
    createdAt: app.createdAt.toISOString(),
  };
}

/**
 * Earliest scheduledAt among pending follow-ups (scheduled, not sent, not
 * cancelled, not bounced) — null when the sequence can't produce another send:
 * terminal stage (rejected/offer/ghosted) or the initial email got a reply.
 */
function nextFollowUpAt(app: IApplication): string | null {
  if (app.stage === 'rejected' || app.stage === 'offer' || app.stage === 'ghosted') return null;
  if (app.emails[0]?.repliedAt) return null;
  let next: Date | null = null;
  for (const email of app.emails) {
    if (email.kind === 'initial') continue;
    if (!email.scheduledAt || email.sentAt || email.cancelledAt || email.bouncedAt) continue;
    if (!next || email.scheduledAt < next) next = email.scheduledAt;
  }
  return next ? next.toISOString() : null;
}

/** Ownership-scoped lookup; cross-user access is indistinguishable from missing. */
async function findOwnApplication(userId: string, id: string): Promise<IApplication> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Application not found');
  }
  const application = await Application.findOne({ _id: id, userId });
  if (!application) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Application not found');
  return application;
}

async function detailEnvelope(app: IApplication): Promise<{ application: ApplicationDetailResponse }> {
  const events = await EmailEvent.find({ applicationId: app._id }).sort({ createdAt: 1 });
  return { application: toDetail(app, events) };
}

/** GET /applications — Kanban list, newest first. */
applicationsRouter.get('/', async (req, res, next) => {
  try {
    const applications = await Application.find({ userId: req.userId! }).sort({ createdAt: -1 });
    const body: ApplicationListResponse = { applications: applications.map(toSummary) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/** GET /applications/:id — full thread + tracking-event timeline. */
applicationsRouter.get('/:id', async (req, res, next) => {
  try {
    const application = await findOwnApplication(req.userId!, req.params.id);
    res.json(await detailEnvelope(application));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /applications/:id — update stage, notes and/or interview fields. A
 * stage change to `rejected`/`offer` stops the follow-up sequence (SPEC §5):
 * pending follow-up subdocs are cancelled and scheduled jobs removed.
 *
 * Interview reminder sync (Phase 3): any change touching interviewAt or the
 * stage first cancels the previously queued `interview-reminder` job, then
 * (re)schedules a fresh one only when the application is in stage `interview`
 * with an interviewAt set — so moving away from interview cancels, moving TO
 * interview with an existing date schedules, and setting/changing/clearing
 * the date always replaces the old job. Scheduling itself skips when
 * interviewAt − 24h is already past.
 */
applicationsRouter.patch('/:id', validate(applicationUpdateSchema), async (req, res, next) => {
  try {
    const application = await findOwnApplication(req.userId!, req.params.id);
    const input = req.body as ApplicationUpdateInput;
    const previousStage = application.stage;

    if (input.stage !== undefined) application.stage = input.stage;
    if (input.notes !== undefined) application.notes = input.notes;
    if (input.interviewAt !== undefined) {
      application.interviewAt = input.interviewAt === null ? null : new Date(input.interviewAt);
    }
    if (input.interviewNote !== undefined) application.interviewNote = input.interviewNote;
    await application.save();

    if (input.stage === 'rejected' || input.stage === 'offer') {
      await stopFollowUpSequence(String(application._id));
    }

    const stageChanged = input.stage !== undefined && input.stage !== previousStage;
    if (input.interviewAt !== undefined || stageChanged) {
      await cancelInterviewReminder(String(application._id));
      if (application.stage === 'interview' && application.interviewAt) {
        await scheduleInterviewReminder(
          String(application._id),
          String(application.userId),
          application.interviewAt,
        );
      }
    }

    res.json(await detailEnvelope(application));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /applications/:id/mark-replied (SPEC §5 reply detection phase 1) —
 * stamps repliedAt on the latest sent email, records a manual `reply` event,
 * advances stage applied → hr_screen (later stages are never clobbered),
 * bumps the template's replied stat, and cancels pending follow-ups.
 * Idempotent: a second call is a no-op beyond returning the same state.
 */
applicationsRouter.post('/:id/mark-replied', async (req, res, next) => {
  try {
    const application = await findOwnApplication(req.userId!, req.params.id);
    await markLatestEmailReplied(application, { manual: true });

    const body: MarkRepliedResponse = await detailEnvelope(application);
    res.json(body);
  } catch (err) {
    next(err);
  }
});
