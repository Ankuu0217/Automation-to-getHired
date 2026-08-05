import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/app';
import { makePdf } from './helpers/makePdf';

/**
 * Full auth + profile flow against an in-memory MongoDB.
 * Covers: register → me → profile get/put → resume upload (PDF sniffing +
 * prefill) → settings patch → refresh rotation → logout.
 */

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Test User', email: 'test@example.com', password: 'password123' };

function cookies(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return Object.fromEntries(list.map((c: string) => c.split(';')[0].split('=')));
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-test'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('auth flow', () => {
  let jar: Record<string, string> = {};

  it('registers a new user and sets httpOnly auth cookies', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(user);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.settings).toEqual({
      autoSend: false,
      dailySendCap: 30,
      followUpEnabled: true,
      tone: 'formal',
      weeklySendGoal: null,
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    jar = cookies(res);
    expect(jar.jm_access).toBeTruthy();
    expect(jar.jm_refresh).toBeTruthy();
    const raw = res.headers['set-cookie'];
    expect(JSON.stringify(raw)).toContain('HttpOnly');
  });

  it('rejects duplicate registration with 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(user);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid payloads with the standard error shape', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'nope', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeTruthy();
  });

  it('GET /auth/me works with cookie and 401s without', async () => {
    const ok = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar));
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe(user.name);
    const denied = await request(app).get('/api/v1/auth/me');
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects wrong password with a uniform 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrongpass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    jar = { ...jar, ...cookies(res) };
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(jar));
    expect(first.status).toBe(200);
    const newJar = cookies(first);
    expect(newJar.jm_refresh).toBeTruthy();
    expect(newJar.jm_refresh).not.toBe(jar.jm_refresh);

    // Reusing the OLD refresh token must fail (rotation invalidated it)
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(jar));
    expect(reuse.status).toBe(401);
    jar = newJar;
  });

  it('updates settings via PATCH /auth/settings', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/settings')
      .set('Cookie', cookieHeader(jar))
      .send({ tone: 'confident', dailySendCap: 15, autoSend: true });
    expect(res.status).toBe(200);
    expect(res.body.user.settings.tone).toBe('confident');
    expect(res.body.user.settings.dailySendCap).toBe(15);
    expect(res.body.user.settings.autoSend).toBe(true);
  });

  it('rejects invalid settings values', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/settings')
      .set('Cookie', cookieHeader(jar))
      .send({ dailySendCap: 5000 });
    expect(res.status).toBe(400);
  });

  it('accepts a weekly send goal and persists it', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/settings')
      .set('Cookie', cookieHeader(jar))
      .send({ weeklySendGoal: 10 });
    expect(res.status).toBe(200);
    expect(res.body.user.settings.weeklySendGoal).toBe(10);
    const meRes = await request(app).get('/api/v1/auth/me').set('Cookie', cookieHeader(jar));
    expect(meRes.body.user.settings.weeklySendGoal).toBe(10);
  });

  it('rejects out-of-range and non-integer weekly send goals', async () => {
    for (const weeklySendGoal of [0, 101, 7.5]) {
      const res = await request(app)
        .patch('/api/v1/auth/settings')
        .set('Cookie', cookieHeader(jar))
        .send({ weeklySendGoal });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('clears the weekly send goal with null', async () => {
    const res = await request(app)
      .patch('/api/v1/auth/settings')
      .set('Cookie', cookieHeader(jar))
      .send({ weeklySendGoal: null });
    expect(res.status).toBe(200);
    expect(res.body.user.settings.weeklySendGoal).toBeNull();
  });

  it('logs out and clears the session', async () => {
    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', cookieHeader(jar));
    expect(res.status).toBe(200);
    // refresh token should be revoked server-side
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(jar));
    expect(refresh.status).toBe(401);
  });
});

describe('profile + resume', () => {
  let jar: Record<string, string> = {};

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    jar = cookies(res);
  });

  it('GET /profile returns the auto-created shell', async () => {
    const res = await request(app).get('/api/v1/profile').set('Cookie', cookieHeader(jar));
    expect(res.status).toBe(200);
    expect(res.body.profile.fullName).toBe(user.name);
    expect(res.body.profile.resumeFile).toBeNull();
  });

  it('PUT /profile updates fields and merges links', async () => {
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Cookie', cookieHeader(jar))
      .send({
        headline: 'Full-stack engineer',
        yearsExp: 5,
        skills: ['TypeScript', 'Node.js'],
        links: { linkedin: 'https://linkedin.com/in/testuser' },
      });
    expect(res.status).toBe(200);
    expect(res.body.profile.headline).toBe('Full-stack engineer');
    expect(res.body.profile.links.linkedin).toBe('https://linkedin.com/in/testuser');
  });

  it('uploads a PDF resume, parses it, and returns prefill suggestions', async () => {
    const pdf = await makePdf(
      'Test User\nFull-stack engineer with TypeScript, React, Node.js, MongoDB and AWS experience. Built and shipped web apps for 5 years.',
    );
    const res = await request(app)
      .post('/api/v1/profile/resume')
      .set('Cookie', cookieHeader(jar))
      .attach('resume', pdf, { filename: 'resume.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.profile.resumeFile.originalName).toBe('resume.pdf');
    expect(res.body.profile.resumeFile.parsedText).toContain('TypeScript');
    expect(res.body.prefill.skills).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Node.js', 'MongoDB', 'AWS']),
    );
    expect(res.body.prefill.summary.length).toBeGreaterThan(20);
    // file actually landed on disk under uploads/resumes
    const uploadDir = path.resolve(__dirname, '../uploads/resumes');
    const files = fs.readdirSync(uploadDir).filter((f) => f.endsWith('.pdf'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('rejects a non-PDF file even with a .pdf name (magic-byte sniff)', async () => {
    const fake = Buffer.from('<html>not a pdf</html>');
    const res = await request(app)
      .post('/api/v1/profile/resume')
      .set('Cookie', cookieHeader(jar))
      .attach('resume', fake, { filename: 'evil.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid PDF/i);
  });

  it('rejects wrong declared MIME type', async () => {
    const res = await request(app)
      .post('/api/v1/profile/resume')
      .set('Cookie', cookieHeader(jar))
      .attach('resume', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('requires auth for all profile routes', async () => {
    expect((await request(app).get('/api/v1/profile')).status).toBe(401);
    expect((await request(app).put('/api/v1/profile').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/profile/resume')).status).toBe(401);
  });
});
