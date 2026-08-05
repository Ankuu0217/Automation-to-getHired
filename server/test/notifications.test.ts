import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import type { EmailDraft, JobExtraction, JobMatch } from '@jobmail/shared';

/**
 * Notifications (Phase 7): emission at the tracking pixel (first open only),
 * mark-replied, bounce recording and the interview reminder; the
 * /api/v1/notifications read API (list + unreadCount, PATCH read, read-all,
 * ownership); and the per-user 100-item history cap. Setup mirrors
 * applicationsFlow.test.ts (mocked AI provider, mailer, MX).
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
/** One-shot sendMail failure — consumed (and reset) by the next send. */
let nextSendMailError: Error | null = null;

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
    sendMail: async () => {
      if (nextSendMailError) {
        const err = nextSendMailError;
        nextSendMailError = null;
        throw err;
      }
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
import { Notification, type INotification } from '../src/models/Notification';
import { Profile } from '../src/models/Profile';
import { processInterviewReminder } from '../src/services/jobs/interviewReminder';
import {
  createNotification,
  NOTIFICATION_HISTORY_CAP,
} from '../src/services/notifications';
import { TRACKING_PIXEL_PNG } from '../src/services/tracking';
import { makePdf } from './helpers/makePdf';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Notify Tester', email: 'notify@example.com', password: 'password123' };
const otherUser = { name: 'Other User', email: 'notify-other@example.com', password: 'password123' };
let cookie = '';
let otherCookie = '';
let userId = '';
let otherUserId = '';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const RESUME_DIR = path.resolve(__dirname, '../uploads/test-resumes');
const RESUME_PATH = path.join(RESUME_DIR, 'resume-notifications.pdf');

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

/**
 * Emission is fire-and-forget (the emitting request may respond before the
 * notification is persisted) — poll until `count` docs match, or time out
 * and return whatever is there so the assertion fails with a real count.
 */
async function waitForNotifications(
  filter: Record<string, unknown>,
  count: number,
): Promise<INotification[]> {
  const start = Date.now();
  for (;;) {
    const docs = await Notification.find(filter).sort({ createdAt: -1, _id: -1 });
    if (docs.length >= count) return docs;
    if (Date.now() - start > 3000) return docs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Let any in-flight fire-and-forget emission land before a "none created" check. */
function settle(ms = 150): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  await mongoose.connect(mongod.getUri('jobmail-notifications-test'));

  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(RESUME_PATH, makePdf('Notify Tester resume Node.js MongoDB'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(user));
  otherCookie = cookies(await request(app).post('/api/v1/auth/register').send(otherUser));
  const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  userId = me.body.user.id as string;
  const otherMe = await request(app).get('/api/v1/auth/me').set('Cookie', otherCookie);
  otherUserId = otherMe.body.user.id as string;

  const profile = await request(app).put('/api/v1/profile').set('Cookie', cookie).send({
    fullName: 'Notify Tester',
    headline: 'Backend Engineer',
    yearsExp: 5,
    skills: ['Node.js', 'MongoDB'],
  });
  expect(profile.status).toBe(200);
  await Profile.updateOne(
    { userId },
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

describe('notifications API — auth', () => {
  it('requires auth on all three endpoints', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
    expect(
      (await request(app).patch(`/api/v1/notifications/${new mongoose.Types.ObjectId()}/read`))
        .status,
    ).toBe(401);
    expect((await request(app).post('/api/v1/notifications/read-all')).status).toBe(401);
  });
});

describe('tracking pixel — first-open notification', () => {
  it('creates exactly one notification on first open; second open creates none; pixel stays identical', async () => {
    const { applicationId } = await sendApplication('PIX');

    const first = await request(app)
      .get(`/api/t/o/${applicationId}/0.png`)
      .set('User-Agent', 'test-agent');
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['content-length']).toBe(String(TRACKING_PIXEL_PNG.length));
    expect(first.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
    expect(first.headers['pragma']).toBe('no-cache');
    expect(first.headers['expires']).toBe('0');
    expect(first.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(first.body.equals(TRACKING_PIXEL_PNG)).toBe(true);

    const created = await waitForNotifications({ applicationId, kind: 'open' }, 1);
    expect(created).toHaveLength(1);
    expect(String(created[0].userId)).toBe(userId);
    expect(created[0].title).toBe('Email opened');
    expect(created[0].body).toBe('Acme PIX opened your email.');
    expect(created[0].read).toBe(false);

    const second = await request(app)
      .get(`/api/t/o/${applicationId}/0.png`)
      .set('User-Agent', 'test-agent');
    expect(second.status).toBe(200);
    expect(second.body.equals(TRACKING_PIXEL_PNG)).toBe(true);
    // Identical headers on the repeat hit — the notification hook changes nothing.
    for (const header of [
      'content-type',
      'content-length',
      'cache-control',
      'pragma',
      'expires',
      'cross-origin-resource-policy',
    ]) {
      expect(second.headers[header]).toBe(first.headers[header]);
    }

    await settle();
    expect(await Notification.countDocuments({ applicationId, kind: 'open' })).toBe(1);
  });
});

describe('mark-replied — reply notification', () => {
  it('creates a reply notification once; a repeat mark-replied stays silent', async () => {
    const { applicationId } = await sendApplication('MR');

    const res = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    const created = await waitForNotifications({ applicationId, kind: 'reply' }, 1);
    expect(created).toHaveLength(1);
    expect(String(created[0].userId)).toBe(userId);
    expect(created[0].title).toBe('Reply received');
    expect(created[0].body).toBe('Acme MR replied.');

    const again = await request(app)
      .post(`/api/v1/applications/${applicationId}/mark-replied`)
      .set('Cookie', cookie);
    expect(again.status).toBe(200);
    await settle();
    expect(await Notification.countDocuments({ applicationId, kind: 'reply' })).toBe(1);
  });
});

describe('bounce recording — bounce notification', () => {
  it('creates a bounce notification when the initial send bounces permanently', async () => {
    mockExtraction = makeExtraction('BN');
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
    const gen = await request(app)
      .post(`/api/v1/jobs/${jobId}/generate-email`)
      .set('Cookie', cookie);
    expect(gen.status).toBe(200);

    nextSendMailError = Object.assign(new Error('550 5.1.1 user unknown'), {
      responseCode: 550,
    });
    const send = await request(app)
      .post(`/api/v1/jobs/${jobId}/send`)
      .set('Cookie', cookie)
      .send({});
    expect(send.status).toBe(200);

    const application = await Application.findOne({ jobPostId: jobId }).lean();
    expect(application).not.toBeNull();
    expect(application!.emails[0].bouncedAt).not.toBeNull();

    const created = await waitForNotifications(
      { applicationId: application!._id, kind: 'bounce' },
      1,
    );
    expect(created).toHaveLength(1);
    expect(String(created[0].userId)).toBe(userId);
    expect(created[0].title).toBe('Delivery failed');
    expect(created[0].body).toBe('Acme BN — delivery failed.');
  });
});

describe('interview reminder — interview notification', () => {
  it('emits an interview notification when the reminder job sends', async () => {
    const { applicationId } = await sendApplication('IV');
    const interviewAt = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();

    const patch = await request(app)
      .patch(`/api/v1/applications/${applicationId}`)
      .set('Cookie', cookie)
      .send({ stage: 'interview', interviewAt });
    expect(patch.status).toBe(200);

    const outcome = await processInterviewReminder({ applicationId, userId, interviewAt });
    expect(outcome).toBe('sent');

    const created = await waitForNotifications({ applicationId, kind: 'interview' }, 1);
    expect(created).toHaveLength(1);
    expect(String(created[0].userId)).toBe(userId);
    expect(created[0].title).toBe('Interview reminder');
    expect(created[0].body).toBe('Interview with Acme IV tomorrow.');
  });
});

describe('GET /notifications — list, unreadCount, PATCH read, read-all, ownership', () => {
  let firstId = '';

  it('lists newest first with a correct unreadCount', async () => {
    // Deterministic fixture on the second user (isolated from emission tests).
    const applicationId = new mongoose.Types.ObjectId();
    for (const [i, kind] of (['open', 'reply', 'bounce'] as const).entries()) {
      await createNotification({
        userId: otherUserId,
        kind,
        applicationId,
        title: `T${i + 1}`,
        body: `B${i + 1}`,
      });
    }

    const res = await request(app).get('/api/v1/notifications').set('Cookie', otherCookie);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(3);
    expect(res.body.notifications).toHaveLength(3);
    // Newest first.
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual([
      'T3',
      'T2',
      'T1',
    ]);
    const [top] = res.body.notifications;
    expect(top).toMatchObject({
      kind: 'bounce',
      applicationId: String(applicationId),
      title: 'T3',
      body: 'B3',
      read: false,
    });
    expect(typeof top.id).toBe('string');
    expect(new Date(top.createdAt).toISOString()).toBe(top.createdAt);
    firstId = top.id as string;
  });

  it('PATCH /:id/read marks one read and decrements unreadCount', async () => {
    const res = await request(app)
      .patch(`/api/v1/notifications/${firstId}/read`)
      .set('Cookie', otherCookie);
    expect(res.status).toBe(200);
    expect(res.body.notification.read).toBe(true);

    const list = await request(app).get('/api/v1/notifications').set('Cookie', otherCookie);
    expect(list.body.unreadCount).toBe(2);
  });

  it('ownership: another user cannot read or mark my notifications', async () => {
    // User A's list never contains B's docs.
    const listA = await request(app).get('/api/v1/notifications').set('Cookie', cookie);
    expect(listA.status).toBe(200);
    for (const n of listA.body.notifications as Array<{ id: string }>) {
      expect(n.id).not.toBe(firstId);
    }

    // A marking B's notification → 404, and the doc is untouched.
    const unread = await Notification.findOne({ userId: otherUserId, read: false });
    expect(unread).not.toBeNull();
    const cross = await request(app)
      .patch(`/api/v1/notifications/${String(unread!._id)}/read`)
      .set('Cookie', cookie);
    expect(cross.status).toBe(404);
    expect((await Notification.findById(unread!._id))!.read).toBe(false);

    // Invalid + unknown ids → 404 too.
    expect(
      (await request(app).patch('/api/v1/notifications/not-an-id/read').set('Cookie', cookie))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/notifications/${new mongoose.Types.ObjectId()}/read`)
          .set('Cookie', cookie)
      ).status,
    ).toBe(404);
  });

  it('POST /read-all marks everything read and reports the count', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Cookie', otherCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });

    const list = await request(app).get('/api/v1/notifications').set('Cookie', otherCookie);
    expect(list.body.unreadCount).toBe(0);

    // Idempotent: nothing left to flip.
    const again = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Cookie', otherCookie);
    expect(again.body).toEqual({ updated: 0 });
  });
});

describe('history cap', () => {
  it('keeps only the newest 100 notifications per user', async () => {
    const capUserId = new mongoose.Types.ObjectId();
    const applicationId = new mongoose.Types.ObjectId();
    for (let i = 1; i <= NOTIFICATION_HISTORY_CAP + 5; i += 1) {
      await createNotification({
        userId: capUserId,
        kind: 'open',
        applicationId,
        title: `N${i}`,
        body: 'body',
      });
    }

    const docs = await Notification.find({ userId: capUserId }).sort({
      createdAt: -1,
      _id: -1,
    });
    expect(docs).toHaveLength(NOTIFICATION_HISTORY_CAP);
    const titles = docs.map((d) => d.title);
    // Newest kept, oldest five pruned.
    expect(titles[0]).toBe(`N${NOTIFICATION_HISTORY_CAP + 5}`);
    expect(titles).toContain('N6');
    for (const gone of ['N1', 'N2', 'N3', 'N4', 'N5']) {
      expect(titles).not.toContain(gone);
    }
  });
});
