import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Tone } from '@jobmail/shared';

/**
 * Phase 5 analytics upgrades: /analytics/timing, /by-template, /by-tone,
 * /response-time. Fixtures are seeded directly through the models (the
 * endpoints are read-only aggregations over Application email subdocs).
 *
 * Fixture matrix (all for the main user):
 *   app1  template A (formal)   sent @ 9am   opened  replied +2h   → '1-4h'
 *   app2  template A (formal)   sent @ 9am   opened  replied +30h  → '1-3d'
 *   app3  template B (friendly) sent @ 2pm   —       —
 *   app4  no template           sent @ 2pm   opened  —
 *
 * Hours are set with setHours() (server-local), matching the service's
 * getHours() bucketing, so assertions are timezone-independent.
 */

let mongod: MongoMemoryServer;

import { createApp } from '../src/app';
import { Application, type IApplicationEmail } from '../src/models/Application';
import { EmailTemplate } from '../src/models/EmailTemplate';

const app = createApp();

const mainUser = { name: 'Analytics Extra', email: 'analytics-extra@example.com', password: 'password123' };
const otherUser = { name: 'Other User', email: 'analytics-other@example.com', password: 'password123' };
let cookie = '';
let otherCookie = '';
let userId = '';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

/** A date `daysAgo` days back at the given server-local hour. */
function atLocalHour(daysAgo: number, hour: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY_MS);
  d.setHours(hour, 15, 0, 0);
  return d;
}

function initialEmail(
  sentAt: Date,
  overrides: { opened?: boolean; replyDelayHours?: number } = {},
): IApplicationEmail {
  return {
    subject: 'Application: Backend Engineer',
    bodyText: 'Hi Priya,\n\nThanks,\nTester',
    bodyHtml: '<p>Hi Priya,</p>',
    kind: 'initial',
    scheduledAt: sentAt,
    sentAt,
    openedAt: overrides.opened ? new Date(sentAt.getTime() + HOUR_MS) : null,
    repliedAt:
      overrides.replyDelayHours !== undefined
        ? new Date(sentAt.getTime() + overrides.replyDelayHours * HOUR_MS)
        : null,
    bouncedAt: null,
    messageId: '<analytics-mock@mail.gmail.com>',
    cancelledAt: null,
  };
}

async function seedApplication(
  templateId: mongoose.Types.ObjectId | null,
  sentAt: Date,
  overrides: { opened?: boolean; replyDelayHours?: number } = {},
) {
  return Application.create({
    userId,
    jobPostId: new mongoose.Types.ObjectId(),
    hrEmail: 'priya@acme.com',
    hrName: 'Priya Sharma',
    company: 'Acme',
    role: 'Backend Engineer',
    stage: 'applied',
    templateId,
    emails: [initialEmail(sentAt, overrides)],
    notes: '',
  });
}

async function createTemplate(name: string, tone: Tone) {
  return EmailTemplate.create({
    userId,
    name,
    tone,
    subjectTemplate: 'Application: {{role}}',
    bodyTemplate: 'Hi {{hrName}},',
    isDefault: false,
    stats: { sent: 0, opened: 0, replied: 0 },
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-analytics-extra-test'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(mainUser));
  const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
  userId = me.body.user.id as string;
  otherCookie = cookies(await request(app).post('/api/v1/auth/register').send(otherUser));

  const templateA = await createTemplate('Direct ask', 'formal');
  const templateB = await createTemplate('Warm intro', 'friendly');

  await seedApplication(templateA._id, atLocalHour(2, 9), { opened: true, replyDelayHours: 2 });
  await seedApplication(templateA._id, atLocalHour(2, 9), { opened: true, replyDelayHours: 30 });
  await seedApplication(templateB._id, atLocalHour(2, 14), {});
  await seedApplication(null, atLocalHour(2, 14), { opened: true });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /api/v1/analytics/timing', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/analytics/timing')).status).toBe(401);
  });

  it('returns all 24 hour slots with open rates and the best hour', async () => {
    const res = await request(app).get('/api/v1/analytics/timing').set('Cookie', cookie);
    expect(res.status).toBe(200);

    // Documented shape: hours always holds the full 24 slots in order.
    expect(res.body.hours).toHaveLength(24);
    res.body.hours.forEach((slot: Record<string, unknown>, index: number) => {
      expect(slot).toEqual({
        hour: index,
        sent: expect.any(Number),
        opened: expect.any(Number),
        openRate: expect.any(Number),
      });
    });

    // 9am: 2 sent, both opened → openRate 1. 2pm: 2 sent, 1 opened → 0.5.
    expect(res.body.hours[9]).toEqual({ hour: 9, sent: 2, opened: 2, openRate: 1 });
    expect(res.body.hours[14]).toEqual({ hour: 14, sent: 2, opened: 1, openRate: 0.5 });
    // An untouched hour is a true zero slot.
    expect(res.body.hours[3]).toEqual({ hour: 3, sent: 0, opened: 0, openRate: 0 });
    // Best hour = highest open rate among hours with sends.
    expect(res.body.bestHour).toBe(9);
  });
});

describe('GET /api/v1/analytics/by-template', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/analytics/by-template')).status).toBe(401);
  });

  it('aggregates per-template rows from application emails, with a No-template row', async () => {
    const res = await request(app).get('/api/v1/analytics/by-template').set('Cookie', cookie);
    expect(res.status).toBe(200);

    // Ordered by sent desc, then name asc → Direct ask, No template, Warm intro.
    expect(res.body.templates).toHaveLength(3);
    const [direct, none, warm] = res.body.templates;

    expect(direct).toEqual({
      templateId: expect.any(String),
      name: 'Direct ask',
      sent: 2,
      opened: 2,
      replied: 2,
      replyRate: 1,
    });
    expect(none).toEqual({
      templateId: null,
      name: 'No template',
      sent: 1,
      opened: 1,
      replied: 0,
      replyRate: 0,
    });
    expect(warm).toEqual({
      templateId: expect.any(String),
      name: 'Warm intro',
      sent: 1,
      opened: 0,
      replied: 0,
      replyRate: 0,
    });
  });
});

describe('GET /api/v1/analytics/by-tone', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/analytics/by-tone')).status).toBe(401);
  });

  it('derives tone from the template used and computes reply rates', async () => {
    const res = await request(app).get('/api/v1/analytics/by-tone').set('Cookie', cookie);
    expect(res.status).toBe(200);

    // Templateless app4 is excluded (tone unknown); enum order formal → friendly.
    expect(res.body).toEqual({
      tones: [
        { tone: 'formal', sent: 2, replied: 2, replyRate: 1 },
        { tone: 'friendly', sent: 1, replied: 0, replyRate: 0 },
      ],
    });
  });
});

describe('GET /api/v1/analytics/response-time', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/analytics/response-time')).status).toBe(401);
  });

  it('buckets sentAt→repliedAt deltas and computes the median', async () => {
    const res = await request(app).get('/api/v1/analytics/response-time').set('Cookie', cookie);
    expect(res.status).toBe(200);

    // All six bands always present, in order; 2h → '1-4h', 30h → '1-3d'.
    expect(res.body.buckets).toEqual([
      { label: '<1h', count: 0 },
      { label: '1-4h', count: 1 },
      { label: '4-24h', count: 0 },
      { label: '1-3d', count: 1 },
      { label: '3-7d', count: 0 },
      { label: '>7d', count: 0 },
    ]);
    // Median of [2h, 30h] = 16h.
    expect(res.body.medianHours).toBe(16);
  });
});

describe('ownership scoping', () => {
  it('another user sees only their own (empty) analytics', async () => {
    const timing = await request(app).get('/api/v1/analytics/timing').set('Cookie', otherCookie);
    expect(timing.status).toBe(200);
    expect(timing.body.bestHour).toBeNull();
    expect(timing.body.hours).toHaveLength(24);
    expect(timing.body.hours.every((h: { sent: number }) => h.sent === 0)).toBe(true);

    const byTemplate = await request(app)
      .get('/api/v1/analytics/by-template')
      .set('Cookie', otherCookie);
    expect(byTemplate.status).toBe(200);
    expect(byTemplate.body.templates).toEqual([]);

    const byTone = await request(app).get('/api/v1/analytics/by-tone').set('Cookie', otherCookie);
    expect(byTone.status).toBe(200);
    expect(byTone.body.tones).toEqual([]);

    const responseTime = await request(app)
      .get('/api/v1/analytics/response-time')
      .set('Cookie', otherCookie);
    expect(responseTime.status).toBe(200);
    expect(responseTime.body.medianHours).toBeNull();
    expect(
      responseTime.body.buckets.every((b: { count: number }) => b.count === 0),
    ).toBe(true);
  });
});
