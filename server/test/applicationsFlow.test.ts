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
let sendMailCalls: Array<{ to: string; html: string }> = [];

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
    sendMail: async (input: { to: string; html: string }) => {
      sendMailCalls.push(input);
      return { messageId: '<mock-msg-id@mail.gmail.com>' };
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
import { TRACKING_PIXEL_PNG } from '../src/services/tracking';
import { makePdf } from './helpers/makePdf';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Job Tester', email: 'kanban@example.com', password: 'password123' };
const otherUser = { name: 'Other User', email: 'other@example.com', password: 'password123' };
let cookie = '';
let otherCookie = '';

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
