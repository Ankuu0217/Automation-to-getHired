import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * DELETE /auth/account (SPEC §8 "Delete my data"): full wipe of user-owned
 * documents and upload files, session terminated, subsequent /auth/me 401s.
 * Gmail is not connected in the test env, so the revoke path is a no-op here.
 */

import { createApp } from '../src/app';
import { User } from '../src/models/User';
import { Profile } from '../src/models/Profile';
import { JobPost } from '../src/models/JobPost';
import { Application } from '../src/models/Application';
import { EmailTemplate } from '../src/models/EmailTemplate';
import { EmailEvent } from '../src/models/EmailEvent';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Delete Me', email: 'delete@example.com', password: 'password123' };
let cookie = '';
let userId = '';

const SCREENSHOT_DIR = path.resolve(__dirname, '../uploads/screenshots');
const RESUME_DIR = path.resolve(__dirname, '../uploads/resumes');
const screenshotPath = path.join(SCREENSHOT_DIR, 'test-delete-account-screenshot');
const resumePath = path.join(RESUME_DIR, 'test-delete-account-resume.pdf');

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-delete-test'));

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(RESUME_DIR, { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(resumePath, Buffer.from('%PDF-1.4 fake'));

  const res = await request(app).post('/api/v1/auth/register').send(user);
  expect(res.status).toBe(201);
  cookie = cookies(res);
  userId = res.body.user.id as string;
}, 120_000);

afterAll(async () => {
  // Clean up in case a test failed mid-wipe.
  fs.rmSync(screenshotPath, { force: true });
  fs.rmSync(resumePath, { force: true });
  await mongoose.disconnect();
  await mongod.stop();
});

describe('DELETE /auth/account', () => {
  it('requires auth', async () => {
    const res = await request(app).delete('/api/v1/auth/account');
    expect(res.status).toBe(401);
  });

  it('wipes every document and upload file the user owns, then 204s', async () => {
    // Seed one of each user-owned document, with files on disk.
    const jobPost = await JobPost.create({
      userId,
      screenshotPath,
      status: 'sent',
      hrEmail: 'hr@acme.com',
    });
    const application = await Application.create({
      userId,
      jobPostId: jobPost._id,
      hrEmail: 'hr@acme.com',
      company: 'Acme',
      role: 'Engineer',
      emails: [
        {
          subject: 'Application: Engineer',
          bodyText: 'Hi',
          bodyHtml: '<p>Hi</p>',
          kind: 'initial',
          scheduledAt: new Date(),
          sentAt: new Date(),
          openedAt: null,
          repliedAt: null,
          bouncedAt: null,
          messageId: '<m1@mail.gmail.com>',
          cancelledAt: null,
        },
      ],
    });
    await EmailEvent.create({ applicationId: application._id, kind: 'open', meta: {} });
    await EmailTemplate.create({
      userId,
      name: 'Default',
      tone: 'formal',
      subjectTemplate: 'Application: {{role}}',
      bodyTemplate: 'Hi {{hrName}}',
      isDefault: true,
    });
    await Profile.updateOne(
      { userId },
      { $set: { resumeFile: { path: resumePath, originalName: 'resume.pdf', uploadedAt: new Date() } } },
    );

    const res = await request(app).delete('/api/v1/auth/account').set('Cookie', cookie);
    expect(res.status).toBe(204);

    expect(await User.countDocuments({ _id: userId })).toBe(0);
    expect(await Profile.countDocuments({ userId })).toBe(0);
    expect(await JobPost.countDocuments({ userId })).toBe(0);
    expect(await Application.countDocuments({ userId })).toBe(0);
    expect(await EmailTemplate.countDocuments({ userId })).toBe(0);
    expect(await EmailEvent.countDocuments({ applicationId: application._id })).toBe(0);
    expect(fs.existsSync(screenshotPath)).toBe(false);
    expect(fs.existsSync(resumePath)).toBe(false);

    // Auth cookies cleared on the response.
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cleared = list.filter((c: string) => c.startsWith('jm_access=') || c.startsWith('jm_refresh='));
    expect(cleared).toHaveLength(2);
  });

  it('subsequent /auth/me with the old cookie returns 401', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('deleting an already-deleted account 401s (session no longer resolves)', async () => {
    const res = await request(app).delete('/api/v1/auth/account').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});
