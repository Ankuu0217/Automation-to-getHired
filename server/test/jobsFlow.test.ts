import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { JobExtraction } from '@jobmail/shared';

/**
 * Jobs flow (M2): upload → async extraction (mocked AI provider) → poll →
 * review corrections → dedupe. MX lookups auto-pass under NODE_ENV=test.
 */

const extractionFixture: JobExtraction = {
  company: 'Acme Corp',
  role: 'Backend Engineer',
  location: 'Bengaluru',
  jdText: 'We are hiring a backend engineer with Node.js and MongoDB experience.',
  hrName: 'Priya Sharma',
  hrEmails: [
    { email: 'info@acme.com', confidence: 0.6 },
    { email: 'priya.sharma@acme.com', confidence: 0.9 },
  ],
  confidence: 0.92,
};

// Mutable so individual tests can steer the mocked provider.
let mockExtraction: JobExtraction = extractionFixture;

vi.mock('../src/services/ai/provider', () => ({
  getAIProvider: () => ({
    name: 'mock',
    extractJobFromImage: async () => ({
      extraction: mockExtraction,
      source: 'vision' as const,
      rawText: mockExtraction.jdText,
    }),
  }),
}));

import { createApp } from '../src/app';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Job Tester', email: 'jobs@example.com', password: 'password123' };
let cookie = '';

// Minimal valid PNG (magic bytes are all the sniffer checks).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

async function uploadScreenshot() {
  const res = await request(app)
    .post('/api/v1/jobs/upload')
    .set('Cookie', cookie)
    .attach('screenshot', PNG, { filename: 'job.png', contentType: 'image/png' });
  expect(res.status).toBe(202);
  return res.body.jobPostId as string;
}

async function waitForExtraction(id: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const res = await request(app).get(`/api/v1/jobs/${id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    if (res.body.job.status !== 'processing') return res.body.job;
    if (Date.now() - start > timeoutMs) throw new Error('Extraction timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-jobs-test'));
  const res = await request(app).post('/api/v1/auth/register').send(user);
  cookie = cookies(res);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('jobs upload + extraction', () => {
  it('requires auth', async () => {
    expect((await request(app).post('/api/v1/jobs/upload')).status).toBe(401);
    expect((await request(app).get('/api/v1/jobs')).status).toBe(401);
  });

  it('rejects a non-image file (magic-byte sniff)', async () => {
    const res = await request(app)
      .post('/api/v1/jobs/upload')
      .set('Cookie', cookie)
      .attach('screenshot', Buffer.from('<html>fake</html>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid image/i);
  });

  it('uploads, extracts asynchronously, and ranks HR emails (name match first)', async () => {
    mockExtraction = extractionFixture;
    const id = await uploadScreenshot();
    const job = await waitForExtraction(id);

    expect(job.status).toBe('extracted');
    expect(job.extraction.company).toBe('Acme Corp');
    expect(job.extraction.source).toBe('vision');
    // priya.sharma@ matches the HR name → outranks generic info@.
    expect(job.hrEmail).toBe('priya.sharma@acme.com');
    expect(job.needsEmail).toBe(false);
    expect(job.dedupeHash).toBeTruthy();

    const list = await request(app).get('/api/v1/jobs').set('Cookie', cookie);
    expect(list.body.jobs.some((j: { id: string }) => j.id === id)).toBe(true);
  });

  it('serves the screenshot back over an authenticated route', async () => {
    const id = await uploadScreenshot();
    const res = await request(app).get(`/api/v1/jobs/${id}/screenshot`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect((await request(app).get(`/api/v1/jobs/${id}/screenshot`)).status).toBe(401);
  });

  it('flags needsEmail when no email is found, and accepts a manual one', async () => {
    mockExtraction = { ...extractionFixture, hrEmails: [], confidence: 0.8 };
    const id = await uploadScreenshot();
    const job = await waitForExtraction(id);
    expect(job.needsEmail).toBe(true);
    expect(job.hrEmail).toBeNull();

    const fixed = await request(app)
      .put(`/api/v1/jobs/${id}/extraction`)
      .set('Cookie', cookie)
      .send({ hrEmail: 'hr@acme.com' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.job.hrEmail).toBe('hr@acme.com');
    expect(fixed.body.job.needsEmail).toBe(false);
    // Manual entry joins the ranked list at top confidence.
    expect(fixed.body.job.extraction.hrEmails[0]).toEqual({ email: 'hr@acme.com', confidence: 1 });
  });

  it('marks low-confidence extractions as needs_review and recovers on correction', async () => {
    mockExtraction = { ...extractionFixture, hrEmails: [], confidence: 0.3 };
    const id = await uploadScreenshot();
    const job = await waitForExtraction(id);
    expect(job.status).toBe('needs_review');

    const fixed = await request(app)
      .put(`/api/v1/jobs/${id}/extraction`)
      .set('Cookie', cookie)
      .send({ company: 'Corrected Co', role: 'Platform Engineer' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.job.status).toBe('extracted');
    expect(fixed.body.job.extraction.company).toBe('Corrected Co');
  });

  it('blocks duplicates: same hrEmail + company + role → failed, then 409 on edit', async () => {
    mockExtraction = extractionFixture; // same company/role/hrEmail as the first job
    const id = await uploadScreenshot();
    const dup = await waitForExtraction(id);
    expect(dup.status).toBe('failed');
    expect(dup.error).toMatch(/duplicate/i);

    // Editing another job onto an existing (hrEmail, company, role) → 409.
    mockExtraction = { ...extractionFixture, hrEmails: [], company: 'Other Co' };
    const otherId = await uploadScreenshot();
    await waitForExtraction(otherId);
    const conflict = await request(app)
      .put(`/api/v1/jobs/${otherId}/extraction`)
      .set('Cookie', cookie)
      .send({ company: 'Acme Corp', role: 'Backend Engineer', hrEmail: 'priya.sharma@acme.com' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('DUPLICATE_APPLICATION');
    expect(conflict.body.error.details.existingJobPostId).toBeTruthy();
  });

  it('rejects invalid emails on manual entry', async () => {
    mockExtraction = { ...extractionFixture, hrEmails: [] };
    const id = await uploadScreenshot();
    await waitForExtraction(id);
    const res = await request(app)
      .put(`/api/v1/jobs/${id}/extraction`)
      .set('Cookie', cookie)
      .send({ hrEmail: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
