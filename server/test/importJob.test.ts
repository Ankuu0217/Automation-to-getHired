import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * POST /jobs/import (Phase 2): pasted JD text → async extraction → poll →
 * dedupe, mirroring the /jobs/upload contract.
 *
 * No provider mock on purpose: vitest.config.ts sets no GEMINI_API_KEY, so
 * the real OcrOnlyProvider handles extractJobFromText via regex heuristics
 * (the image/tesseract OCR path is never touched for text imports). MX
 * lookups auto-pass under NODE_ENV=test.
 */

vi.hoisted(() => {
  // Belt and braces: even if the shell exports GEMINI_API_KEY, this file must
  // exercise the heuristic (OcrOnlyProvider) fallback path.
  process.env.GEMINI_API_KEY = '';
});

import { createApp } from '../src/app';
import { resetAIProvider } from '../src/services/ai/provider';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Import Tester', email: 'import@example.com', password: 'password123' };
let cookie = '';

/** Heuristic-friendly JD: "X is hiring a Y in Z" + apply-context email.
 * (Role avoids "in"/"at" substrings — the lazy heuristic regex stops there.) */
const JOB_TEXT = `Acme Corp is hiring a Backend Developer in Bengaluru.
We need strong Node.js, MongoDB and TypeScript experience, plus REST API design.
Location: Bengaluru
Send your resume to priya.sharma@acme.com to apply.`;

const OTHER_JOB_TEXT = `Globex Corporation is hiring a Platform Engineer in Pune.
You will own our Kubernetes clusters and CI pipelines end to end.
Contact: email your CV to hr@globex.com today.`;

/** Reference server that must NEVER be hit — sourceUrl is a link, not a fetch target. */
let refServer: http.Server;
let refUrl = '';
let refHits = 0;

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

async function importText(rawText: string, sourceUrl?: string) {
  const res = await request(app)
    .post('/api/v1/jobs/import')
    .set('Cookie', cookie)
    .send(sourceUrl === undefined ? { rawText } : { rawText, sourceUrl });
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
  resetAIProvider();
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-import-test'));
  const res = await request(app).post('/api/v1/auth/register').send(user);
  cookie = cookies(res);

  refServer = http.createServer((_req, res) => {
    refHits += 1;
    res.end('should never be fetched');
  });
  await new Promise<void>((resolve) => refServer.listen(0, '127.0.0.1', resolve));
  refUrl = `http://127.0.0.1:${(refServer.address() as AddressInfo).port}/jobs/123`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => refServer.close(() => resolve()));
  await mongoose.disconnect();
  await mongod.stop();
});

describe('jobs import (pasted text)', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/v1/jobs/import').send({ rawText: JOB_TEXT });
    expect(res.status).toBe(401);
  });

  it('rejects rawText shorter than 40 characters', async () => {
    const res = await request(app)
      .post('/api/v1/jobs/import')
      .set('Cookie', cookie)
      .send({ rawText: 'too short to be a job description' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid sourceUrl', async () => {
    const res = await request(app)
      .post('/api/v1/jobs/import')
      .set('Cookie', cookie)
      .send({ rawText: JOB_TEXT, sourceUrl: 'not a url' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('imports pasted text and extracts company/role heuristically (no API key)', async () => {
    const id = await importText(JOB_TEXT);
    const job = await waitForExtraction(id);

    // Heuristic confidence caps below 0.5 → needs_review, never a hard fail.
    expect(job.status).toBe('needs_review');
    expect(job.extraction.company).toBe('Acme Corp');
    expect(job.extraction.role).toBe('Backend Developer');
    expect(job.extraction.source).toBe('ocr');
    expect(job.extraction.jdText).toContain('Node.js');
    expect(job.hrEmail).toBe('priya.sharma@acme.com');
    expect(job.needsEmail).toBe(false);
    expect(job.dedupeHash).toBeTruthy();
    expect(job.hasScreenshot).toBe(false);
    expect(job.sourceUrl).toBeNull();

    // No screenshot exists for text imports — the serving route 404s cleanly.
    const shot = await request(app).get(`/api/v1/jobs/${id}/screenshot`).set('Cookie', cookie);
    expect(shot.status).toBe(404);

    const list = await request(app).get('/api/v1/jobs').set('Cookie', cookie);
    expect(list.body.jobs.some((j: { id: string }) => j.id === id)).toBe(true);
  });

  it('blocks duplicate imports like upload: same hrEmail + company + role → failed', async () => {
    const id = await importText(JOB_TEXT); // identical text → identical dedupe hash
    const dup = await waitForExtraction(id);
    expect(dup.status).toBe('failed');
    expect(dup.error).toMatch(/duplicate/i);
    expect(dup.dedupeHash).toBeNull();
  });

  it('stores sourceUrl as a reference and never fetches it', async () => {
    const id = await importText(OTHER_JOB_TEXT, refUrl);
    const job = await waitForExtraction(id);

    expect(job.status).toBe('needs_review');
    expect(job.sourceUrl).toBe(refUrl);
    expect(job.extraction.company).toBe('Globex Corporation');
    expect(job.hrEmail).toBe('hr@globex.com');
    // The whole pipeline ran (extraction finished) with zero requests to the URL.
    expect(refHits).toBe(0);
  });
});
