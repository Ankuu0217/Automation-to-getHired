import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

import { createApp } from '../src/app';
import { Profile } from '../src/models/Profile';
import { User } from '../src/models/User';
import { makePdf } from './helpers/makePdf';

let mongod: MongoMemoryServer;
const app = createApp();
const user = { name: 'Resume Tester', email: 'resume-download@example.com', password: 'password123' };
let cookie = '';
let userId = '';
let tmpDir = '';

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

/** Buffer the raw response body (superagent has no default parser for application/pdf). */
function binaryParser(resp: request.Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  resp.on('data', (chunk: Buffer) => chunks.push(chunk));
  resp.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function setResumeFile(resumeFile: {
  path: string;
  originalName: string;
  parsedText: string;
  uploadedAt: Date;
}): Promise<void> {
  await Profile.findOneAndUpdate({ userId }, { $set: { resumeFile } }, { upsert: true });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-profile-resume-test'));
  const res = await request(app).post('/api/v1/auth/register').send(user);
  cookie = cookies(res);
  const dbUser = await User.findOne({ email: user.email });
  userId = String(dbUser!._id);
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jobmail-resume-dl-'));
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
  if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('GET /api/v1/profile/resume/download', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/profile/resume/download')).status).toBe(401);
  });

  it('returns 404 RESUME_NOT_FOUND when no resume has been uploaded', async () => {
    const res = await request(app).get('/api/v1/profile/resume/download').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESUME_NOT_FOUND');
    expect(res.body.error.message).toBeTruthy();
  });

  it('streams the stored PDF with an attachment header and the exact file bytes', async () => {
    const pdf = makePdf('Jane Doe resume for the download test with enough words to wrap a line');
    const filePath = path.join(tmpDir, 'stored-resume.pdf');
    await fs.promises.writeFile(filePath, pdf);
    await setResumeFile({
      path: filePath,
      originalName: 'Jane Doe Resume.pdf',
      parsedText: 'Jane Doe resume text',
      uploadedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/v1/profile/resume/download')
      .set('Cookie', cookie)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Jane Doe Resume.pdf"');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(Buffer.compare(res.body as Buffer, pdf)).toBe(0);
  });

  it('sanitizes unsafe characters out of the download filename', async () => {
    const pdf = makePdf('sanitize me');
    const filePath = path.join(tmpDir, 'weird-name.pdf');
    await fs.promises.writeFile(filePath, pdf);
    await setResumeFile({
      path: filePath,
      originalName: 'Ada "the\\ analyst"\r\nrésumé.pdf',
      parsedText: 'x',
      uploadedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/v1/profile/resume/download')
      .set('Cookie', cookie)
      .buffer(true)
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const disposition = res.headers['content-disposition'];
    expect(disposition.startsWith('attachment; filename="')).toBe(true);
    // No CR/LF, inner quotes, backslashes, or non-ASCII may survive into the header.
    const inner = disposition.slice('attachment; filename="'.length, -1);
    expect(inner).toBe('Ada the analystrsum.pdf');
  });

  it('returns 404 RESUME_NOT_FOUND when the stored file is missing on disk', async () => {
    await setResumeFile({
      path: path.join(tmpDir, 'deleted-since.pdf'),
      originalName: 'Gone.pdf',
      parsedText: 'x',
      uploadedAt: new Date(),
    });

    const res = await request(app).get('/api/v1/profile/resume/download').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESUME_NOT_FOUND');
  });
});
