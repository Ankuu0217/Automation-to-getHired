import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import type { EmailDraft, JobExtraction, JobMatch } from '@jobmail/shared';

/**
 * Send flow (M3): upload → extract → generate → send, with QUEUE_INLINE=true
 * (vitest config) so the Agenda send-email job runs synchronously. AI provider
 * and the mailer transport are mocked — no Gmail, no network. MX lookups are
 * steered via a module mock (hasMxRecord auto-passes under NODE_ENV=test).
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

// Mutable steering knobs for the mocked modules.
let mockExtraction: JobExtraction = makeExtraction('A');
let mockSendMail: () => Promise<{ messageId: string }> = async () => ({
  messageId: '<mock-msg-id@mail.gmail.com>',
});
let mockHasMx: (domain: string) => Promise<boolean> = async () => true;
let sendMailCalls: Array<{ to: string; attachments?: Array<{ filename: string }> }> = [];

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

// Mock at the mailer boundary (never Gmail); keep the real error classes.
vi.mock('../src/services/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/mailer')>();
  return {
    ...actual,
    sendMail: async (input: { to: string; attachments?: Array<{ filename: string }> }) => {
      sendMailCalls.push(input);
      return mockSendMail();
    },
  };
});

vi.mock('../src/utils/emailValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/emailValidation')>();
  return { ...actual, hasMxRecord: (domain: string) => mockHasMx(domain) };
});

import { createApp } from '../src/app';
import { Profile } from '../src/models/Profile';
import { User } from '../src/models/User';
import { Application } from '../src/models/Application';
import { GmailNotConnectedError } from '../src/services/mailer';
import { computeSendTime } from '../src/services/jobs/schedule';
import { resumeAttachmentName } from '../src/services/jobs/sendEmail';
import { makePdf } from './helpers/makePdf';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Job Tester', email: 'send@example.com', password: 'password123' };
let cookie = '';
let userId = '';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const RESUME_DIR = path.resolve(__dirname, '../uploads/test-resumes');
const RESUME_PATH = path.join(RESUME_DIR, 'resume.pdf');

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

async function uploadAndExtract(tag: string, extraction?: JobExtraction) {
  mockExtraction = extraction ?? makeExtraction(tag);
  const res = await request(app)
    .post('/api/v1/jobs/upload')
    .set('Cookie', cookie)
    .attach('screenshot', PNG, { filename: 'job.png', contentType: 'image/png' });
  expect(res.status).toBe(202);
  const id = res.body.jobPostId as string;

  const start = Date.now();
  for (;;) {
    const poll = await request(app).get(`/api/v1/jobs/${id}`).set('Cookie', cookie);
    expect(poll.status).toBe(200);
    if (poll.body.job.status !== 'processing') return poll.body.job;
    if (Date.now() - start > 5000) throw new Error('Extraction timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function uploadExtractGenerate(tag: string) {
  const uploaded = await uploadAndExtract(tag);
  expect(uploaded.status).toBe('extracted');
  const gen = await request(app)
    .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
    .set('Cookie', cookie);
  expect(gen.status).toBe(200);
  return gen.body.job;
}

async function setResumeFile(file: { path: string; originalName: string } | null) {
  await Profile.updateOne(
    { userId },
    {
      $set: {
        resumeFile: file ? { ...file, parsedText: 'resume text', uploadedAt: new Date() } : null,
      },
    },
  );
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-send-test'));

  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(RESUME_PATH, makePdf('Job Tester resume Node.js MongoDB'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(user));
  const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  userId = me.body.user.id as string;

  const profile = await request(app).put('/api/v1/profile').set('Cookie', cookie).send({
    fullName: 'Job Tester',
    headline: 'Backend Engineer',
    yearsExp: 5,
    skills: ['Node.js', 'MongoDB'],
  });
  expect(profile.status).toBe(200);
  await setResumeFile({ path: RESUME_PATH, originalName: 'resume.pdf' });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('POST /jobs/:id/send — happy path', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/v1/jobs/000000000000000000000000/send').send({});
    expect(res.status).toBe(401);
  });

  it('queues, sends inline, creates the Application, and persists messageId', async () => {
    const job = await uploadExtractGenerate('A');
    sendMailCalls = [];

    const res = await request(app).post(`/api/v1/jobs/${job.id}/send`).set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(true);
    expect(new Date(res.body.scheduledAt).getTime()).toBeGreaterThan(Date.now());

    // Inline queue: the send already ran by the time the response returned.
    const fetched = await request(app).get(`/api/v1/jobs/${job.id}`).set('Cookie', cookie);
    expect(fetched.body.job.status).toBe('sent');
    expect(fetched.body.job.failureCode).toBeNull();

    const application = await Application.findOne({ jobPostId: job.id }).lean();
    expect(application).not.toBeNull();
    expect(application!.stage).toBe('applied');
    expect(application!.hrEmail).toBe('priya-a@acme.com');
    expect(application!.company).toBe('Acme A');
    // Initial + 2 pending follow-up subdocs (M5, followUpEnabled defaults true).
    expect(application!.emails).toHaveLength(3);
    expect(application!.emails[0].kind).toBe('initial');
    expect(application!.emails[0].messageId).toBe('<mock-msg-id@mail.gmail.com>');
    expect(application!.emails[0].sentAt).not.toBeNull();
    expect(application!.emails[0].scheduledAt).not.toBeNull();
    expect(application!.emails[0].subject).toBe(draftFixture.subject);

    // Mailer got the draft + the renamed resume attachment (SPEC §5).
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0].to).toBe('priya-a@acme.com');
    expect(sendMailCalls[0].attachments?.[0].filename).toBe('Job_Tester_Resume.pdf');

    const dbUser = await User.findById(userId).lean();
    expect(dbUser!.lastSendError).toBeNull();
  });

  it('rejects a second send on an already-sent job', async () => {
    const job = await uploadExtractGenerate('B');
    const first = await request(app).post(`/api/v1/jobs/${job.id}/send`).set('Cookie', cookie).send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/jobs/${job.id}/send`)
      .set('Cookie', cookie)
      .send({});
    expect(second.status).toBe(409);
  });

  it('honors a requested scheduledAt (jittered, not before it)', async () => {
    const job = await uploadExtractGenerate('C');
    const requested = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const res = await request(app)
      .post(`/api/v1/jobs/${job.id}/send`)
      .set('Cookie', cookie)
      .send({ scheduledAt: requested.toISOString() });
    expect(res.status).toBe(200);
    const scheduledAt = new Date(res.body.scheduledAt).getTime();
    expect(scheduledAt).toBeGreaterThanOrEqual(requested.getTime() + 2 * 60 * 1000 - 1000);
    expect(scheduledAt).toBeLessThanOrEqual(requested.getTime() + 8 * 60 * 1000 + 1000);
  });
});

describe('POST /jobs/:id/send — validation', () => {
  it('blocks send when the job has no HR email', async () => {
    const uploaded = await uploadAndExtract('D', { ...makeExtraction('D'), hrEmails: [] });
    expect(uploaded.needsEmail).toBe(true);

    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/send`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/HR email/i);
  });

  it('blocks send when there is no draft', async () => {
    const uploaded = await uploadAndExtract('E');
    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/send`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/draft/i);
  });
});

describe('send-email job — terminal failures', () => {
  it('MX-invalid domain marks the job failed and skips the send', async () => {
    const job = await uploadExtractGenerate('F');
    sendMailCalls = [];
    mockHasMx = async () => false;

    const res = await request(app).post(`/api/v1/jobs/${job.id}/send`).set('Cookie', cookie).send({});
    expect(res.status).toBe(200); // enqueue succeeded; failure surfaces on the job

    const fetched = await request(app).get(`/api/v1/jobs/${job.id}`).set('Cookie', cookie);
    expect(fetched.body.job.status).toBe('failed');
    expect(fetched.body.job.failureCode).toBe('MX_INVALID_DOMAIN');
    expect(fetched.body.job.error).toMatch(/mail server/i);
    expect(sendMailCalls).toHaveLength(0);
    expect(await Application.countDocuments({ jobPostId: job.id })).toBe(0);

    mockHasMx = async () => true;
  });

  it('missing resume blocks the send with RESUME_MISSING (SPEC §9.9)', async () => {
    const job = await uploadExtractGenerate('G');
    await setResumeFile(null);
    sendMailCalls = [];

    const res = await request(app).post(`/api/v1/jobs/${job.id}/send`).set('Cookie', cookie).send({});
    expect(res.status).toBe(200);

    const fetched = await request(app).get(`/api/v1/jobs/${job.id}`).set('Cookie', cookie);
    expect(fetched.body.job.status).toBe('failed');
    expect(fetched.body.job.failureCode).toBe('RESUME_MISSING');
    expect(fetched.body.job.error).toMatch(/resume/i);
    expect(sendMailCalls).toHaveLength(0);
    expect(await Application.countDocuments({ jobPostId: job.id })).toBe(0);

    await setResumeFile({ path: RESUME_PATH, originalName: 'resume.pdf' });
  });

  it('Gmail disconnected mid-queue: job failed GMAIL_NOT_CONNECTED + user banner state', async () => {
    const job = await uploadExtractGenerate('H');
    mockSendMail = async () => {
      throw new GmailNotConnectedError('Gmail connection expired — reconnect in Settings to resume sending');
    };

    const res = await request(app).post(`/api/v1/jobs/${job.id}/send`).set('Cookie', cookie).send({});
    expect(res.status).toBe(200);

    const fetched = await request(app).get(`/api/v1/jobs/${job.id}`).set('Cookie', cookie);
    expect(fetched.body.job.status).toBe('failed');
    expect(fetched.body.job.failureCode).toBe('GMAIL_NOT_CONNECTED');

    const dbUser = await User.findById(userId).lean();
    expect(dbUser!.lastSendError).toMatch(/reconnect/i);
    expect(await Application.countDocuments({ jobPostId: job.id })).toBe(0);

    // Recover: reconnect (successful send) clears the banner.
    mockSendMail = async () => ({ messageId: '<recovered@mail.gmail.com>' });
    const job2 = await uploadExtractGenerate('I');
    const res2 = await request(app)
      .post(`/api/v1/jobs/${job2.id}/send`)
      .set('Cookie', cookie)
      .send({});
    expect(res2.status).toBe(200);
    const dbUser2 = await User.findById(userId).lean();
    expect(dbUser2!.lastSendError).toBeNull();
  });
});

describe('GET /gmail/connect', () => {
  it('returns 503 OAUTH_NOT_CONFIGURED when Google credentials are absent (test env)', async () => {
    expect((await request(app).get('/api/v1/gmail/connect')).status).toBe(401);

    const res = await request(app).get('/api/v1/gmail/connect').set('Cookie', cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('OAUTH_NOT_CONFIGURED');
  });
});

describe('computeSendTime — caps and jitter (SPEC §5)', () => {
  const base = new Date('2026-07-23T14:30:00');

  it('adds 2–8 min jitter in the normal case', () => {
    const atMin = computeSendTime({ base, sentToday: 0, sentThisHour: 0, dailyCap: 30, random: () => 0 });
    const atMax = computeSendTime({ base, sentToday: 0, sentThisHour: 0, dailyCap: 30, random: () => 0.999 });
    expect(atMin.getTime()).toBe(base.getTime() + 2 * 60 * 1000);
    expect(atMax.getTime()).toBeLessThanOrEqual(base.getTime() + 8 * 60 * 1000);
  });

  it('pushes to the next hour when the hourly cap (10) is reached', () => {
    const t = computeSendTime({ base, sentToday: 5, sentThisHour: 10, dailyCap: 30, random: () => 0 });
    expect(t.getTime()).toBe(new Date('2026-07-23T15:02:00').getTime());
  });

  it('reschedules to next day 9–11 AM when the daily cap is reached', () => {
    const early = computeSendTime({ base, sentToday: 30, sentThisHour: 0, dailyCap: 30, random: () => 0 });
    const late = computeSendTime({ base, sentToday: 30, sentThisHour: 0, dailyCap: 30, random: () => 0.999 });
    expect(early.getTime()).toBe(new Date('2026-07-24T09:00:00').getTime());
    expect(late.getTime()).toBeLessThanOrEqual(new Date('2026-07-24T11:00:00').getTime());
    expect(early.getDate()).toBe(base.getDate() + 1);
  });

  it('respects a custom daily cap', () => {
    const t = computeSendTime({ base, sentToday: 5, sentThisHour: 0, dailyCap: 5, random: () => 0 });
    expect(t.getTime()).toBe(new Date('2026-07-24T09:00:00').getTime());
  });
});

describe('resumeAttachmentName', () => {
  it('renames to FirstName_LastName_Resume.pdf', () => {
    expect(resumeAttachmentName('Job Tester')).toBe('Job_Tester_Resume.pdf');
    expect(resumeAttachmentName('Madonna')).toBe('Madonna_Resume.pdf');
    expect(resumeAttachmentName('  ')).toBe('Resume.pdf');
    expect(resumeAttachmentName('João Silva-Santos!')).toBe('Joo_Silva-Santos_Resume.pdf');
  });
});
