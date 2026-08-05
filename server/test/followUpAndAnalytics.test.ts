import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { ApplicationStage } from '@jobmail/shared';

/**
 * Follow-up processors, ghosted sweep, templates, and analytics tests (M5).
 * AI and mailer are mocked; tests hit the real DB and REST routes where useful.
 */

let mockSendMail: (input: { to: string; html: string; inReplyTo?: string; references?: string }) => Promise<{ messageId: string }> =
  async () => ({ messageId: '<followup-mock@mail.gmail.com>' });

vi.mock('../src/services/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/mailer')>();
  return {
    ...actual,
    sendMail: async (input: { to: string; html: string; inReplyTo?: string; references?: string }) => mockSendMail(input),
  };
});

import { createApp } from '../src/app';
import { Application, type IApplicationEmail } from '../src/models/Application';
import { EmailEvent } from '../src/models/EmailEvent';
import { EmailTemplate } from '../src/models/EmailTemplate';
import { User } from '../src/models/User';
import { processMarkGhosted, processSendFollowUp } from '../src/services/jobs/followups';

let mongod: MongoMemoryServer;
const app = createApp();

const userPayload = { name: 'FollowUp Tester', email: 'followup@example.com', password: 'password123' };
let cookie = '';
let userId = '';

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

async function createApplication(
  stage: ApplicationStage,
  overrides: {
    initialSentDaysAgo?: number;
    repliedAtDaysAgo?: number;
    bouncedAtDaysAgo?: number;
    followUpScheduledDaysAgo?: number;
  } = {},
) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const sentAt = new Date(now - (overrides.initialSentDaysAgo ?? 1) * dayMs);

  const emails: IApplicationEmail[] = [
    {
      subject: 'Application: Backend Engineer',
      bodyText: 'Hi Priya,\n\nThanks,\nTester',
      bodyHtml: '<p>Hi Priya,</p>',
      kind: 'initial',
      scheduledAt: sentAt,
      sentAt,
      openedAt: null,
      repliedAt: overrides.repliedAtDaysAgo ? new Date(now - overrides.repliedAtDaysAgo * dayMs) : null,
      bouncedAt: overrides.bouncedAtDaysAgo ? new Date(now - overrides.bouncedAtDaysAgo * dayMs) : null,
      messageId: '<initial-mock@mail.gmail.com>',
      cancelledAt: null,
    },
  ];

  if (overrides.followUpScheduledDaysAgo !== undefined) {
    const scheduledAt = new Date(now - overrides.followUpScheduledDaysAgo * dayMs);
    emails.push({
      subject: 'Re: Application: Backend Engineer',
      bodyText: 'Just following up — still interested.',
      bodyHtml: '',
      kind: 'followup_1',
      scheduledAt,
      sentAt: null,
      openedAt: null,
      repliedAt: null,
      bouncedAt: null,
      messageId: null,
      cancelledAt: null,
    });
  }

  return Application.create({
    userId,
    jobPostId: new mongoose.Types.ObjectId(),
    hrEmail: 'priya@acme.com',
    hrName: 'Priya Sharma',
    company: 'Acme',
    role: 'Backend Engineer',
    stage,
    emails,
    notes: '',
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-followup-test'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(userPayload));
  const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  userId = me.body.user.id as string;
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('processSendFollowUp', () => {
  it('sends a due follow-up and threads it to the initial email', async () => {
    const application = await createApplication('applied', { followUpScheduledDaysAgo: 1 });
    const result = await processSendFollowUp({ applicationId: String(application._id), emailIndex: 1 });

    expect(result).toBe('sent');
    const updated = await Application.findById(application._id);
    expect(updated!.emails[1].sentAt).not.toBeNull();
    expect(updated!.emails[1].messageId).toBe('<followup-mock@mail.gmail.com>');
    expect(updated!.emails[1].bodyHtml).toContain('/api/t/o/');
  });

  it('stops the sequence when the thread has a reply', async () => {
    const application = await createApplication('applied', {
      repliedAtDaysAgo: 1,
      followUpScheduledDaysAgo: 1,
    });
    const result = await processSendFollowUp({ applicationId: String(application._id), emailIndex: 1 });

    expect(result).toBe('stopped');
    const updated = await Application.findById(application._id);
    expect(updated!.emails[1].cancelledAt).not.toBeNull();
    expect(updated!.emails[1].sentAt).toBeNull();
  });

  it('stops the sequence on a terminal stage', async () => {
    const application = await createApplication('offer', { followUpScheduledDaysAgo: 1 });
    const result = await processSendFollowUp({ applicationId: String(application._id), emailIndex: 1 });

    expect(result).toBe('stopped');
    const updated = await Application.findById(application._id);
    expect(updated!.emails[1].cancelledAt).not.toBeNull();
  });

  it('records a bounce and cancels remaining follow-ups on permanent SMTP failure', async () => {
    mockSendMail = async () => {
      const err = new Error('5.1.1 Address rejected') as Error & { responseCode: number };
      err.responseCode = 550;
      throw err;
    };

    const application = await createApplication('applied', { followUpScheduledDaysAgo: 1 });
    const result = await processSendFollowUp({ applicationId: String(application._id), emailIndex: 1 });

    expect(result).toBe('bounced');
    const updated = await Application.findById(application._id);
    expect(updated!.emails[1].bouncedAt).not.toBeNull();
    expect(updated!.emails[1].cancelledAt).not.toBeNull();

    const events = await EmailEvent.find({ applicationId: application._id, kind: 'bounce' });
    expect(events.length).toBe(1);

    mockSendMail = async () => ({ messageId: '<followup-mock@mail.gmail.com>' });
  });
});

describe('processMarkGhosted', () => {
  it('moves stale applied applications to ghosted after 14 days of no reply', async () => {
    const stale = await createApplication('applied', { initialSentDaysAgo: 15 });
    const fresh = await createApplication('applied', { initialSentDaysAgo: 2 });

    const marked = await processMarkGhosted();
    expect(marked).toBeGreaterThanOrEqual(1);

    const staleNow = await Application.findById(stale._id);
    expect(staleNow!.stage).toBe('ghosted');

    const freshNow = await Application.findById(fresh._id);
    expect(freshNow!.stage).toBe('applied');
  });
});

describe('Templates API', () => {
  it('CRUDs templates and enforces a single default', async () => {
    const create = await request(app)
      .post('/api/v1/templates')
      .set('Cookie', cookie)
      .send({
        name: 'Test Template',
        tone: 'confident',
        subjectTemplate: 'Application: {{role}}',
        bodyTemplate: 'Hi {{hrName}},\n\nI fit {{role}} at {{company}}.',
        isDefault: true,
      });
    expect(create.status).toBe(201);
    const firstId = create.body.template.id as string;

    const list = await request(app).get('/api/v1/templates').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.templates.length).toBe(1);

    const createSecond = await request(app)
      .post('/api/v1/templates')
      .set('Cookie', cookie)
      .send({
        name: 'Second Template',
        tone: 'friendly',
        subjectTemplate: '{{role}} at {{company}}',
        bodyTemplate: 'Hi {{hrName}},',
        isDefault: true,
      });
    expect(createSecond.status).toBe(201);

    const listAfter = await request(app).get('/api/v1/templates').set('Cookie', cookie);
    expect(listAfter.body.templates.filter((t: { isDefault: boolean }) => t.isDefault).length).toBe(1);

    const updated = await request(app)
      .put(`/api/v1/templates/${firstId}`)
      .set('Cookie', cookie)
      .send({ name: 'Renamed Template' });
    expect(updated.status).toBe(200);
    expect(updated.body.template.name).toBe('Renamed Template');

    const deleted = await request(app).delete(`/api/v1/templates/${firstId}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);

    const finalList = await request(app).get('/api/v1/templates').set('Cookie', cookie);
    expect(finalList.body.templates.length).toBe(1);
  });
});

describe('GET /analytics/funnel', () => {
  it('returns totals, rates, per-template stats and a 30-day trend', async () => {
    const template = await EmailTemplate.create({
      userId,
      name: 'Analytics Template',
      tone: 'formal',
      subjectTemplate: 'Subj',
      bodyTemplate: 'Body',
      isDefault: false,
      stats: { sent: 1, opened: 1, replied: 1 },
    });

    const application = await createApplication('interview');
    application.templateId = template._id;
    await application.save();

    await EmailEvent.create({
      applicationId: application._id,
      kind: 'open',
      meta: {},
      createdAt: new Date(),
    });

    const res = await request(app).get('/api/v1/analytics/funnel').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.totals.sent).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.interviews).toBeGreaterThanOrEqual(1);
    expect(res.body.rates.responseRate).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.perTemplate)).toBe(true);
    expect(res.body.perTemplate[0].replyRate).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.trend)).toBe(true);
    expect(res.body.trend.length).toBe(30);
  });
});
