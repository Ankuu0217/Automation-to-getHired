import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import type { EmailDraft, JobExtraction, JobMatch } from '@jobmail/shared';

/**
 * Applications API + tracking pixel (M4): upload → extract → generate → send
 * (QUEUE_INLINE) → Kanban list/detail → PATCH stage/notes → mark-replied →
 * pixel open tracking. AI provider, mailer and MX lookups are mocked, same
 * as in sendFlow.test.ts.
 */

function makeExtraction(tag: string): JobExtraction {
  return {
    company: `Acme ${tag}`,
    role: 'Backend Engineer',
    location: 'Bengaluru',
    jdText: 'We are hiring a backend engineer with Node.js and MongoDB experience.',
    hrName: 'Priya Sharma',
    hrEmails: [{ email: `priya-${tag.toLowerCase()}@acme.com`, confidence: 0.9 }],
    confidence: 0.92,
  };
}

const matchFixture: JobMatch = {
  score: 82,
  matchedSkills: ['Node.js', 'MongoDB'],
  gaps: [],
  angle: '5+ years of Node.js experience mapping onto the Backend Engineer requirements',
};

const draftFixture: EmailDraft = {
  subject: 'Application: Backend Engineer, 5 yrs Node.js',
  bodyText: 'Hi Priya,\n\nYour Backend Engineer opening caught my eye.\n\nThanks,\nJob Tester',
  bodyHtml: '<p>Hi Priya,</p>',
};

let mockExtraction: JobExtraction = makeExtraction('A');
let sendMailCalls: Array<{ to: string; subject: string; text: string; html: string }> = [];
/** One-shot sendMail failure — consumed (and reset) by the next send. */
let nextSendMailError: Error | null = null;

/* Interview reminder scheduling spies (Phase 3) — wrappers record calls, then
 * delegate to the real fns (no-ops under QUEUE_INLINE). */
let interviewScheduleCalls: Array<{ applicationId: string; interviewAt: string }> = [];
let interviewCancelCalls: string[] = [];

vi.mock('../src/services/ai/provider', () => ({
  getAIProvider: () => ({
    name: 'mock',
    extractJobFromImage: async () => ({
      extraction: mockExtraction,
      source: 'vision' as const,
      rawText: mockExtraction.jdText,
    }),
    analyzeMatch: async () => matchFixture,
    generateOutreachEmail: async () => draftFixture,
  }),
}));

vi.mock('../src/services/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/mailer')>();
  return {
    ...actual,
    sendMail: async (input: { to: string; subject: string; text: string; html: string }) => {
      if (nextSendMailError) {
        const err = nextSendMailError;
        nextSendMailError = null;
        throw err;
      }
      sendMailCalls.push(input);
      return { messageId: '<mock-msg-id@mail.gmail.com>' };
    },
  };
});

vi.mock('../src/services/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/queue')>();
  return {
    ...actual,
    scheduleInterviewReminder: async (applicationId: string, userId: string, interviewAt: Date) => {
      interviewScheduleCalls.push({ applicationId, interviewAt: interviewAt.toISOString() });
      return actual.scheduleInterviewReminder(applicationId, userId, interviewAt);
    },
    cancelInterviewReminder: async (applicationId: string) => {
      interviewCancelCalls.push(applicationId);
      return actual.cancelInterviewReminder(applicationId);
    },
  };
});

vi.mock('../src/utils/emailValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/emailValidation')>();
  return { ...actual, hasMxRecord: async () => true };
});

import { createApp } from '../src/app';
import { Application } from '../src/models/Application';
import { EmailEvent } from '../src/models/EmailEvent';
import { Profile } from '../src/models/Profile';
import { User } from '../src/models/User';
import { GmailNotConnectedError } from '../src/services/mailer';
import { processInterviewReminder } from '../src/services/jobs/interviewReminder';
import {
  cancelInterviewReminder,
  INTERVIEW_REMINDER_LEAD_MS,
  scheduleInterviewReminder,
} from '../src/services/queue';
import { TRACKING_PIXEL_PNG } from '../src/services/tracking';
import { makePdf } from './helpers/makePdf';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Job Tester', email: 'kanban@example.com', password: 'password123' };
const otherUser = { name: 'Other User', email: 'other@example.com', password: 'password123' };
let cookie = '';
let otherCookie = '';
let userId = '';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const RESUME_DIR = path.resolve(__dirname, '../uploads/test-resumes');
const RESUME_PATH = path.join(RESUME_DIR, 'resume-m4.pdf');

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

/** Full happy path: upload → extract → generate → inline send. */
async function sendApplication(tag: string): Promise<{ jobId: string; applicationId: string }> {
  mockExtraction = makeExtraction(tag);
  const upload = await request(app)
    .post('/api/v1/jobs/upload')
    .set('Cookie', cookie)
    .attach('screenshot', PNG, { filename: 'job.png', contentType: 'image/png' });
  expect(upload.status).toBe(202);
  const jobId = upload.body.jobPostId as string;

  const start = Date.now();
  for (;;) {
    const poll = await request(app).get(`/api/v1/jobs/${jobId}`).set('Cookie', cookie);
    if (poll.body.job.status !== 'processing') break;
    if (Date.now() - start > 5000) throw new Error('Extraction timed out');
    await new Promise((r) => setTimeout(r, 100));
  }

  const gen = await request(app).post(`/api/v1/jobs/${jobId}/generate-email`).set('Cookie', cookie);
  expect(gen.status).toBe(200);

  const send = await request(app).post(`/api/v1/jobs/${jobId}/send`).set('Cookie', cookie).send({});
  expect(send.status).toBe(200);

  const application = await Application.findOne({ jobPostId: jobId }).lean();
  expect(application).not.toBeNull();
  return { jobId, applicationId: String(application!._id) };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-m4-test'));

  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(RESUME_PATH, makePdf('Job Tester resume Node.js MongoDB'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(user));
  otherCookie = cookies(await request(app).post('/api/v1/auth/register').send(otherUser));
  const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  userId = me.body.user.id as string;

  const profile = await request(app).put('/api/v1/profile').set('Cookie', cookie).send({
    fullName: 'Job Tester',
    headline: 'Backend Engineer',
    yearsExp: 5,
    skills: ['Node.js', 'MongoDB'],
  });
  expect(profile.status).toBe(200);
  await Profile.updateOne(
    { userId: me.body.user.id },
    {
      $set: {
        resumeFile: {
          path: RESUME_PATH,
          originalName: 'resume.pdf',
          parsedText: 'resume text',
          uploadedAt: new Date(),
        },
      },
    },
  );
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('send pipeline — tracking pixel injection', () => {
  it('sends HTML with the pixel URL pointing at the persisted application', async () => {
    sendMailCalls = [];
    const { applicationId } = await sendApplication('PIX');

    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0].html).toContain(
      `http://localhost:4000/api/t/o/${applicationId}/0.png`,
    );

    // The stored email body matches what was actually sent.
    const application = await Application.findById(applicationId).lean();
    expect(application!.emails[0].bodyHtml).toBe(sendMailCalls[0].html);
  });
});

describe('GET /applications — Kanban list', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/applications')).status).toBe(401);
  });

  it('lists sent applications with stage applied, newest first', async () => {
    await sendApplication('L1');
    const second = await sendApplication('L2');

    const res = await request(app).get('/api/v1/applications').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const { applications } = res.body;
    const l2 = applications.find((a: { id: string }) => a.id === second.applicationId);
    expect(l2).toMatchObject({
      company: 'Acme L2',
      role: 'Backend Engineer',
      hrName: 'Priya Sharma',
      hrEmail: 'priya-l2@acme.com',
      stage: 'applied',
      daysSinceSent: 0,
    });
    expect(l2.lastEmail).toMatchObject({ kind: 'initial', openedAt: null, repliedAt: null, bouncedAt: null });
    expect(l2.lastEmail.sentAt).toBeTruthy();

    // Newest first.
    const createdAts = applications.map((a: { createdAt: string }) => a.createdAt);
    for (let i = 1; i < createdAts.length; i += 1) {
      expect(createdAts[i - 1] >= createdAts[i]).toBe(true);
    }

    // Other user sees nothing of ours.
    const other = await request(app).get('/api/v1/applications').set('Cookie', otherCookie);
    expect(other.status).toBe(200);
    expect(other.body.applications).toHaveLength(0);
  });
});

describe('GET /applications/:id — detail + events timeline', () => {
  it('returns the full thread and an (initially empty) events timeline', async () => {
    const { applicationId } = await sendApplication('DET');
    const res = await request(app)
      .get(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const { application } = res.body;
    expect(application.id).toBe(applicationId);
    expect(application.stage).toBe('applied');
    // Initial + 2 pending follow-up subdocs (M5).
    expect(application.emails).toHaveLength(3);
    expect(application.emails[0]).toMatchObject({
      subject: draftFixture.subject,
      kind: 'initial',
      openedAt: null,
      repliedAt: null,
      bouncedAt: null,
      messageId: '<mock-msg-id@mail.gmail.com>',
    });
    expect(application.emails[0].bodyHtml).toContain(`/api/t/o/${applicationId}/0.png`);
    expect(application.events).toEqual([]);
    expect(application.notes).toBe('');
  });

  it('404s for cross-user access and invalid ids', async () => {
    const { applicationId } = await sendApplication('XUSER');
    const cross = await request(app)
      .get(`/api/v1/applications/${applicationId}`)
      .set('Cookie', otherCookie);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');

    const invalid = await request(app)
      .get('/api/v1/applications/not-an-id')
      .set('Cookie', cookie);
    expect(invalid.status).toBe(404);
  });
});

describe('PATCH /applications/:id', () => {
  it('updates stage and notes', async () => {
    const { applicationId } = await sendApplication('PAT');
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', notes: 'Met at a meetup' });
    expect(res.status).toBe(200);
    expect(res.body.application.stage).toBe('interview');
    expect(res.body.application.notes).toBe('Met at a meetup');
  });

  it('rejects invalid stage values and empty bodies', async () => {
    const { applicationId } = await sendApplication('PATV');
    const bad = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'hired' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const empty = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({});
    expect(empty.status).toBe(400);
  });

  it('404s for cross-user updates', async () => {
    const { applicationId } = await sendApplication('PATX');
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', otherCookie)
      .send({ stage: 'rejected' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /applications/:id — interview tracking (Phase 3)', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('accepts interviewAt + interviewNote, returns them, and (re)schedules the reminder', async () => {
    const { applicationId } = await sendApplication('INT1');
    interviewScheduleCalls = [];
    interviewCancelCalls = [];

    const interviewAt = new Date(Date.now() + 72 * HOUR_MS).toISOString();
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', interviewAt, interviewNote: 'Bring the portfolio' });
    expect(res.status).toBe(200);
    expect(res.body.application.interviewAt).toBe(interviewAt);
    expect(res.body.application.interviewNote).toBe('Bring the portfolio');

    // Cancel-then-reschedule: the old job is always removed first.
    expect(interviewCancelCalls).toEqual([applicationId]);
    expect(interviewScheduleCalls).toEqual([{ applicationId, interviewAt }]);
  });

  it('rejects an invalid interviewAt', async () => {
    const { applicationId } = await sendApplication('INT2');
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ interviewAt: 'next tuesday 2pm' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('clears interview fields with null and cancels the reminder without rescheduling', async () => {
    const { applicationId } = await sendApplication('INT3');
    const interviewAt = new Date(Date.now() + 72 * HOUR_MS).toISOString();
    await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', interviewAt, interviewNote: 'Prep system design' });

    interviewScheduleCalls = [];
    interviewCancelCalls = [];
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ interviewAt: null, interviewNote: null });
    expect(res.status).toBe(200);
    expect(res.body.application.interviewAt).toBeNull();
    expect(res.body.application.interviewNote).toBeNull();
    expect(interviewCancelCalls).toEqual([applicationId]);
    expect(interviewScheduleCalls).toHaveLength(0);
  });

  it('stores interviewAt while stage is not interview but does not schedule', async () => {
    const { applicationId } = await sendApplication('INT4'); // stage: applied
    interviewScheduleCalls = [];
    interviewCancelCalls = [];

    const interviewAt = new Date(Date.now() + 72 * HOUR_MS).toISOString();
    const res = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ interviewAt });
    expect(res.status).toBe(200);
    expect(res.body.application.stage).toBe('applied');
    expect(res.body.application.interviewAt).toBe(interviewAt);
    expect(interviewScheduleCalls).toHaveLength(0); // stage guard
    expect(interviewCancelCalls).toEqual([applicationId]); // stale job still removed
  });

  it('cancels when the stage leaves interview and reschedules when it returns', async () => {
    const { applicationId } = await sendApplication('INT5');
    const interviewAt = new Date(Date.now() + 72 * HOUR_MS).toISOString();
    await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', interviewAt });

    interviewScheduleCalls = [];
    interviewCancelCalls = [];
    const away = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'hr_screen' });
    expect(away.status).toBe(200);
    expect(away.body.application.interviewAt).toBe(interviewAt); // date kept
    expect(interviewCancelCalls).toEqual([applicationId]);
    expect(interviewScheduleCalls).toHaveLength(0);

    const back = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview' });
    expect(back.status).toBe(200);
    expect(interviewScheduleCalls).toEqual([{ applicationId, interviewAt }]);
  });

  it('includes the interview fields in the list summary DTO', async () => {
    const { applicationId } = await sendApplication('INT6');
    const interviewAt = new Date(Date.now() + 72 * HOUR_MS).toISOString();
    await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', interviewAt, interviewNote: 'Round 2 with the CTO' });

    const res = await request(app).get('/api/v1/applications').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const summary = res.body.applications.find((a: { id: string }) => a.id === applicationId);
    expect(summary).toMatchObject({
      stage: 'interview',
      interviewAt,
      interviewNote: 'Round 2 with the CTO',
    });
  });
});

describe('interview-reminder scheduling + job processor (Phase 3)', () => {
  const HOUR_MS = 60 * 60 * 1000;

  it('scheduleInterviewReminder targets interviewAt − 24h and skips when that is past', async () => {
    const applicationId = '64b7f9c2e4b0a1f2c3d4e5f6';
    const in72h = new Date(Date.now() + 72 * HOUR_MS);
    const scheduled = await scheduleInterviewReminder(applicationId, userId, in72h);
    expect(scheduled).not.toBeNull();
    expect(scheduled!.remindAt.getTime()).toBe(in72h.getTime() - INTERVIEW_REMINDER_LEAD_MS);

    const in2h = new Date(Date.now() + 2 * HOUR_MS);
    expect(await scheduleInterviewReminder(applicationId, userId, in2h)).toBeNull();

    // Inline mode: cancel is a no-op and must not throw.
    await expect(cancelInterviewReminder(applicationId)).resolves.toBeUndefined();
  });

  it('emails the USER their reminder with company, role, time and note', async () => {
    const { applicationId } = await sendApplication('REM1');
    const interviewAt = new Date(Date.now() + 30 * HOUR_MS);
    await Application.updateOne(
      { _id: applicationId },
      { $set: { stage: 'interview', interviewAt, interviewNote: 'Ask about team structure' } },
    );

    sendMailCalls = [];
    const outcome = await processInterviewReminder({
      applicationId,
      userId,
      interviewAt: interviewAt.toISOString(),
    });
    expect(outcome).toBe('sent');
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0].to).toBe(user.email); // the user's OWN address, not HR
    expect(sendMailCalls[0].subject).toBe('Interview with Acme REM1 tomorrow');
    expect(sendMailCalls[0].text).toContain('Role: Backend Engineer');
    expect(sendMailCalls[0].text).toContain('Time: ');
    expect(sendMailCalls[0].text).toContain('Ask about team structure');
  });

  it('skips when the stage moved on, the time moved, or the interview already passed', async () => {
    const { applicationId } = await sendApplication('REM2');
    const interviewAt = new Date(Date.now() + 30 * HOUR_MS);
    sendMailCalls = [];

    // Stage no longer interview.
    await Application.updateOne(
      { _id: applicationId },
      { $set: { stage: 'offer', interviewAt } },
    );
    expect(
      await processInterviewReminder({
        applicationId,
        userId,
        interviewAt: interviewAt.toISOString(),
      }),
    ).toBe('skipped');

    // interviewAt moved since this job was queued.
    await Application.updateOne({ _id: applicationId }, { $set: { stage: 'interview' } });
    expect(
      await processInterviewReminder({
        applicationId,
        userId,
        interviewAt: new Date(interviewAt.getTime() + 6 * HOUR_MS).toISOString(),
      }),
    ).toBe('skipped');

    // Interview already happened.
    const past = new Date(Date.now() - HOUR_MS);
    await Application.updateOne({ _id: applicationId }, { $set: { interviewAt: past } });
    expect(
      await processInterviewReminder({
        applicationId,
        userId,
        interviewAt: past.toISOString(),
      }),
    ).toBe('skipped');

    expect(sendMailCalls).toHaveLength(0);
  });

  it('treats a missing Gmail transport as best-effort: skipped, lastSendError untouched', async () => {
    const { applicationId } = await sendApplication('REM3');
    const interviewAt = new Date(Date.now() + 30 * HOUR_MS);
    await Application.updateOne(
      { _id: applicationId },
      { $set: { stage: 'interview', interviewAt } },
    );

    nextSendMailError = new GmailNotConnectedError();
    const outcome = await processInterviewReminder({
      applicationId,
      userId,
      interviewAt: interviewAt.toISOString(),
    });
    expect(outcome).toBe('skipped'); // caught — never crashes the job runner

    const dbUser = await User.findById(userId);
    expect(dbUser!.lastSendError).toBeNull(); // reminder failures never trip the send banner
  });
});

describe('POST /applications/:id/mark-replied', () => {
  it('sets repliedAt, records a manual reply event, advances applied → hr_screen, idempotent', async () => {
    const { applicationId } = await sendApplication('REP');

    const first = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.body.application.stage).toBe('hr_screen');
    const repliedAt = first.body.application.emails[0].repliedAt as string;
    expect(repliedAt).toBeTruthy();
    expect(first.body.application.events).toHaveLength(1);
    expect(first.body.application.events[0]).toMatchObject({ kind: 'reply', meta: { manual: true } });

    // Second call: no new event, repliedAt unchanged.
    const second = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', cookie);
    expect(second.status).toBe(200);
    expect(second.body.application.emails[0].repliedAt).toBe(repliedAt);
    expect(second.body.application.events).toHaveLength(1);
    expect(await EmailEvent.countDocuments({ applicationId, kind: 'reply' })).toBe(1);
  });

  it('does not clobber a stage later than applied', async () => {
    const { applicationId } = await sendApplication('REPL');
    await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview' });

    const res = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.application.stage).toBe('interview');
    expect(res.body.application.emails[0].repliedAt).toBeTruthy();
  });

  it('404s for cross-user access', async () => {
    const { applicationId } = await sendApplication('REPX');
    const res = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', otherCookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/t/o/:applicationId/:idx.png — tracking pixel', () => {
  it('serves the 1×1 PNG with no-store headers and records the first open', async () => {
    const { applicationId } = await sendApplication('OPEN');

    const res = await request(app)
      .get(`/api/t/o/${applicationId}/0.png`)
      .set('User-Agent', 'Mozilla/5.0 TestMailClient');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers.expires).toBe('0');
    expect(res.body.equals(TRACKING_PIXEL_PNG)).toBe(true);

    const application = await Application.findById(applicationId).lean();
    const firstOpenedAt = application!.emails[0].openedAt;
    expect(firstOpenedAt).not.toBeNull();

    const events = await EmailEvent.find({ applicationId, kind: 'open' }).lean();
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ ua: 'Mozilla/5.0 TestMailClient' });

    // Second hit: another event, openedAt untouched.
    const again = await request(app).get(`/api/t/o/${applicationId}/0.png`);
    expect(again.status).toBe(200);
    const after = await Application.findById(applicationId).lean();
    expect(after!.emails[0].openedAt!.getTime()).toBe(firstOpenedAt!.getTime());
    expect(await EmailEvent.countDocuments({ applicationId, kind: 'open' })).toBe(2);
  });

  it('always returns 200 + pixel for unknown ids, bad indexes, and garbage params', async () => {
    const unknown = await request(app).get('/api/t/o/64b7f9c2e4b0a1f2c3d4e5f6/0.png');
    expect(unknown.status).toBe(200);
    expect(unknown.headers['content-type']).toBe('image/png');
    expect(unknown.body.equals(TRACKING_PIXEL_PNG)).toBe(true);

    const garbage = await request(app).get('/api/t/o/not-an-object-id/0.png');
    expect(garbage.status).toBe(200);
    expect(garbage.body.equals(TRACKING_PIXEL_PNG)).toBe(true);

    const { applicationId } = await sendApplication('BADIDX');
    const badIdx = await request(app).get(`/api/t/o/${applicationId}/7.png`);
    expect(badIdx.status).toBe(200);
    const application = await Application.findById(applicationId).lean();
    expect(application!.emails[0].openedAt).toBeNull();
    expect(await EmailEvent.countDocuments({ applicationId })).toBe(0);
  });

  it('needs no auth cookie', async () => {
    const { applicationId } = await sendApplication('NOAUTH');
    const res = await request(app).get(`/api/t/o/${applicationId}/0.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });
});
