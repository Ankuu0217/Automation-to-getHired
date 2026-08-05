import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app';
import { Application } from '../src/models/Application';
import { JobPost } from '../src/models/JobPost';
import { User } from '../src/models/User';

let mongod: MongoMemoryServer;
const app = createApp();

const userA = { name: 'Contact Tester', email: 'contacts-a@example.com', password: 'password123' };
const userB = { name: 'Other Tester', email: 'contacts-b@example.com', password: 'password123' };
let cookieA = '';
let cookieB = '';
let userAId = '';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
function daysAgo(days: number, extraHours = 2): Date {
  return new Date(Date.now() - days * DAY_MS - extraHours * HOUR_MS);
}

const ACME_RECRUITER = 'recruiter@acme.com';
const GLOBEX_RECRUITER = 'other@globex.com';
const BOUNCED_RECRUITER = 'bounce@acme.com';

/** sentAt of the most recent email to the Acme recruiter (application 2). */
const acmeLatestSentAt = daysAgo(2);

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

function makeEmail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    subject: 'Application for the role',
    bodyText: 'Hello there',
    bodyHtml: '<p>Hello there</p>',
    kind: 'initial',
    scheduledAt: null,
    sentAt: null,
    openedAt: null,
    repliedAt: null,
    bouncedAt: null,
    messageId: null,
    cancelledAt: null,
    ...overrides,
  };
}

/** JobPost + its Application, the way the send pipeline persists them. */
async function seedOutreach(input: {
  userId: string;
  hrEmail: string;
  hrName?: string | null;
  company?: string | null;
  role?: string | null;
  emails: ReturnType<typeof makeEmail>[];
}) {
  const job = await JobPost.create({
    userId: input.userId,
    status: 'sent',
    hrEmail: input.hrEmail,
  });
  const application = await Application.create({
    userId: input.userId,
    jobPostId: job._id,
    hrEmail: input.hrEmail,
    hrName: input.hrName ?? null,
    company: input.company ?? null,
    role: input.role ?? null,
    stage: 'applied',
    emails: input.emails,
  });
  return { job, application };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-contacts-test'));

  cookieA = cookies(await request(app).post('/api/v1/auth/register').send(userA));
  cookieB = cookies(await request(app).post('/api/v1/auth/register').send(userB));
  userAId = String((await User.findOne({ email: userA.email }))!._id);

  // Two applications to the same Acme recruiter (older one has the name).
  await seedOutreach({
    userId: userAId,
    hrEmail: ACME_RECRUITER,
    hrName: 'Priya Sharma',
    company: 'Acme',
    role: 'Frontend Engineer',
    emails: [makeEmail({ sentAt: daysAgo(10) })],
  });
  await seedOutreach({
    userId: userAId,
    hrEmail: ACME_RECRUITER,
    company: 'Acme',
    role: 'Backend Engineer',
    emails: [
      makeEmail({ sentAt: acmeLatestSentAt, openedAt: daysAgo(1, 12), repliedAt: daysAgo(1) }),
    ],
  });
  // One stale contact (outside the 14-day recent-contact window).
  await seedOutreach({
    userId: userAId,
    hrEmail: GLOBEX_RECRUITER,
    hrName: 'Sam Lee',
    company: 'Globex',
    role: 'Data Engineer',
    emails: [makeEmail({ sentAt: daysAgo(15) })],
  });
  // Bounced-only outreach: an application exists but nothing was ever sent.
  await seedOutreach({
    userId: userAId,
    hrEmail: BOUNCED_RECRUITER,
    company: 'Acme',
    role: 'Platform Engineer',
    emails: [makeEmail({ bouncedAt: daysAgo(1) })],
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /api/v1/contacts', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/contacts')).status).toBe(401);
    expect(
      (await request(app).get(`/api/v1/contacts/${encodeURIComponent(ACME_RECRUITER)}`)).status,
    ).toBe(401);
  });

  it('groups applications by recruiter with counts, ordering and reply state', async () => {
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(3);

    const [first, second, third] = res.body.contacts;

    // Two applications to the same address collapse into one row.
    expect(first.email).toBe(ACME_RECRUITER);
    expect(first.outreachCount).toBe(2);
    expect(first.name).toBe('Priya Sharma');
    expect(first.companies).toEqual(['Acme']);
    expect(first.roles).toEqual(['Backend Engineer', 'Frontend Engineer']);
    expect(first.lastContactedAt).toBe(acmeLatestSentAt.toISOString());
    expect(first.anyReplied).toBe(true);

    // Sorted by lastContactedAt desc…
    expect(second.email).toBe(GLOBEX_RECRUITER);
    expect(second.outreachCount).toBe(1);
    expect(second.anyReplied).toBe(false);

    // …with never-sent (bounced-only) contacts last, lastContactedAt null.
    expect(third.email).toBe(BOUNCED_RECRUITER);
    expect(third.lastContactedAt).toBeNull();
    expect(third.anyReplied).toBe(false);
  });

  it('scopes to the owner — user B sees none of user A contacts', async () => {
    const res = await request(app).get('/api/v1/contacts').set('Cookie', cookieB);
    expect(res.status).toBe(200);
    expect(res.body.contacts).toEqual([]);
  });
});

describe('GET /api/v1/contacts/:email', () => {
  it('returns the full outreach history to one address', async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${encodeURIComponent(ACME_RECRUITER)}`)
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.contact.email).toBe(ACME_RECRUITER);
    expect(res.body.contact.name).toBe('Priya Sharma');
    expect(res.body.contact.applications).toHaveLength(2);

    const replied = res.body.contact.applications.find(
      (a: { role: string | null }) => a.role === 'Backend Engineer',
    );
    expect(replied.stage).toBe('applied');
    expect(replied.emails).toHaveLength(1);
    expect(replied.emails[0].kind).toBe('initial');
    expect(replied.emails[0].sentAt).toBe(acmeLatestSentAt.toISOString());
    expect(replied.emails[0].openedAt).not.toBeNull();
    expect(replied.emails[0].repliedAt).not.toBeNull();
  });

  it('lowercases the address param', async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${encodeURIComponent('RECRUITER@ACME.COM')}`)
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.contact.email).toBe(ACME_RECRUITER);
  });

  it('404s for a never-contacted address', async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${encodeURIComponent('nobody@nowhere.com')}`)
      .set('Cookie', cookieA);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404s for another user (indistinguishable from never-contacted)', async () => {
    const res = await request(app)
      .get(`/api/v1/contacts/${encodeURIComponent(ACME_RECRUITER)}`)
      .set('Cookie', cookieB);
    expect(res.status).toBe(404);
  });
});

describe('recentContact flag on GET /api/v1/jobs/:id', () => {
  it('flags a second job to a recruiter contacted within 14 days', async () => {
    const job = await JobPost.create({
      userId: userAId,
      status: 'extracted',
      hrEmail: ACME_RECRUITER,
    });
    const res = await request(app).get(`/api/v1/jobs/${job._id}`).set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.job.recentContact).toEqual({
      email: ACME_RECRUITER,
      daysAgo: 2,
      company: 'Acme',
    });
  });

  it('is absent when the last contact is older than 14 days', async () => {
    const job = await JobPost.create({
      userId: userAId,
      status: 'extracted',
      hrEmail: GLOBEX_RECRUITER,
    });
    const res = await request(app).get(`/api/v1/jobs/${job._id}`).set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.job.recentContact).toBeNull();
  });

  it('ignores the job own application (same-application sends never flag)', async () => {
    const solo = 'solo@initech.com';
    const { job } = await seedOutreach({
      userId: userAId,
      hrEmail: solo,
      company: 'Initech',
      role: 'SRE',
      emails: [makeEmail({ sentAt: daysAgo(3) })],
    });

    // The only recent send to this address came from this very application.
    const own = await request(app).get(`/api/v1/jobs/${job._id}`).set('Cookie', cookieA);
    expect(own.status).toBe(200);
    expect(own.body.job.recentContact).toBeNull();

    // A DIFFERENT job targeting the same address is flagged.
    const other = await JobPost.create({ userId: userAId, status: 'extracted', hrEmail: solo });
    const res = await request(app).get(`/api/v1/jobs/${other._id}`).set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.job.recentContact).toEqual({ email: solo, daysAgo: 3, company: 'Initech' });
  });

  it('is absent when the job has no candidate email', async () => {
    const job = await JobPost.create({ userId: userAId, status: 'extracted', hrEmail: null });
    const res = await request(app).get(`/api/v1/jobs/${job._id}`).set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.job.recentContact).toBeNull();
  });
});
