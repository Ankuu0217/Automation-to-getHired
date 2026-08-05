import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { EmailDraft, JobExtraction, JobMatch, OutreachEmailInput } from '@jobmail/shared';
import {
  countWords,
  emailBodyToHtml,
  findBannedPhrases,
  repairOutreachEmail,
  validateOutreachEmail,
} from '../src/services/emailRules';
import { analyzeMatchHeuristic, generateEmailFromTemplate } from '../src/services/ai/outreach';

/**
 * M3: match analysis + outreach email generation. AI provider mocked like
 * jobsFlow.test.ts; MX lookups auto-pass under NODE_ENV=test.
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
  gaps: ['Kubernetes'],
  angle: '5+ years of Node.js experience that maps directly onto the Backend Engineer requirements',
};

const draftFixture: EmailDraft = {
  subject: 'Application: Backend Engineer, 5 yrs Node.js',
  bodyText:
    'Hi Priya,\n\nYour Backend Engineer opening caught my eye — the emphasis on Node.js and MongoDB matches what I build with every day.\n\nWould you be open to a short 15-minute call this week?\n\nThanks,\nJob Tester',
  bodyHtml: '<p>Hi Priya,</p>',
};

let mockExtraction: JobExtraction = makeExtraction('A');
let mockMatch: JobMatch = matchFixture;
let mockDraft: EmailDraft = draftFixture;
let analyzeCalls = 0;
let lastEmailInput: OutreachEmailInput | null = null;

vi.mock('../src/services/ai/provider', () => ({
  getAIProvider: () => ({
    name: 'mock',
    extractJobFromImage: async () => ({
      extraction: mockExtraction,
      source: 'vision' as const,
      rawText: mockExtraction.jdText,
    }),
    analyzeMatch: async () => {
      analyzeCalls += 1;
      return mockMatch;
    },
    generateOutreachEmail: async (input: OutreachEmailInput) => {
      lastEmailInput = input;
      return mockDraft;
    },
  }),
}));

import { createApp } from '../src/app';
import { Profile } from '../src/models/Profile';

let mongod: MongoMemoryServer;
const app = createApp();

const user = { name: 'Job Tester', email: 'm3@example.com', password: 'password123' };
let cookie = '';
let cookieNoProfile = '';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function cookies(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((c: string) => c.split(';')[0]).join('; ');
}

async function uploadAndExtract(tag: string, as = cookie) {
  mockExtraction = makeExtraction(tag);
  const res = await request(app)
    .post('/api/v1/jobs/upload')
    .set('Cookie', as)
    .attach('screenshot', PNG, { filename: 'job.png', contentType: 'image/png' });
  expect(res.status).toBe(202);
  const id = res.body.jobPostId as string;

  const start = Date.now();
  for (;;) {
    const poll = await request(app).get(`/api/v1/jobs/${id}`).set('Cookie', as);
    expect(poll.status).toBe(200);
    if (poll.body.job.status !== 'processing') return poll.body.job;
    if (Date.now() - start > 5000) throw new Error('Extraction timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('jobmail-m3-test'));

  cookie = cookies(await request(app).post('/api/v1/auth/register').send(user));
  const profile = await request(app).put('/api/v1/profile').set('Cookie', cookie).send({
    fullName: 'Job Tester',
    headline: 'Backend Engineer',
    yearsExp: 5,
    skills: ['Node.js', 'MongoDB', 'TypeScript'],
    phone: '+91 90000 00000',
    links: { linkedin: 'https://linkedin.com/in/jobtester', portfolio: 'https://jobtester.dev' },
  });
  expect(profile.status).toBe(200);

  cookieNoProfile = cookies(
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'No Profile', email: 'noprofile@example.com', password: 'password123' }),
  );
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('POST /jobs/:id/generate-email', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/v1/jobs/000000000000000000000000/generate-email');
    expect(res.status).toBe(401);
  });

  it('runs match analysis + generation, persists both, and sets email_drafted', async () => {
    mockMatch = matchFixture;
    mockDraft = draftFixture;
    const uploaded = await uploadAndExtract('A');
    expect(uploaded.status).toBe('extracted');

    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    const job = res.body.job;
    expect(job.status).toBe('email_drafted');
    expect(job.match).toEqual(matchFixture);
    expect(job.lowMatch).toBe(false);
    expect(job.draft.subject).toBe(draftFixture.subject);
    expect(job.draft.bodyText).toContain('15-minute call');

    // Persisted: a fresh GET returns the same match + draft.
    const fetched = await request(app).get(`/api/v1/jobs/${uploaded.id}`).set('Cookie', cookie);
    expect(fetched.body.job.match.score).toBe(82);
    expect(fetched.body.job.draft.subject).toBe(draftFixture.subject);
  });

  it('blocks generation when the job still needs an HR email', async () => {
    const uploaded = await uploadAndExtract('B');
    // Strip the HR email via the review route (needsEmail → true).
    const stripped = await request(app)
      .put(`/api/v1/jobs/${uploaded.id}/extraction`)
      .set('Cookie', cookie)
      .send({ hrEmail: null });
    expect(stripped.body.job.needsEmail).toBe(true);

    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/HR email/i);
  });

  it('blocks generation when extraction failed (duplicate)', async () => {
    // Same company/role/hrEmail as the happy-path job → dedupe → failed.
    const dup = await uploadAndExtract('A');
    expect(dup.status).toBe('failed');

    const res = await request(app)
      .post(`/api/v1/jobs/${dup.id}/generate-email`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/extraction has not completed/i);
  });

  it('requires an existing profile', async () => {
    // Registration creates a profile shell; remove it to hit the 400 path.
    await Profile.deleteOne({ fullName: 'No Profile' });
    const uploaded = await uploadAndExtract('C', cookieNoProfile);
    expect(uploaded.status).toBe('extracted');

    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
      .set('Cookie', cookieNoProfile);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/profile/i);
  });

  it('flags lowMatch when the score is below 40 but still drafts', async () => {
    mockMatch = { ...matchFixture, score: 30 };
    const uploaded = await uploadAndExtract('D');

    const res = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.job.match.score).toBe(30);
    expect(res.body.job.lowMatch).toBe(true);
    expect(res.body.job.status).toBe('email_drafted');
    mockMatch = matchFixture;
  });
});

describe('PUT /jobs/:id/draft', () => {
  let jobId = '';

  beforeAll(async () => {
    const uploaded = await uploadAndExtract('E');
    const gen = await request(app)
      .post(`/api/v1/jobs/${uploaded.id}/generate-email`)
      .set('Cookie', cookie);
    expect(gen.status).toBe(200);
    jobId = uploaded.id;
  });

  it('saves manual edits and rebuilds HTML from bodyText', async () => {
    const bodyText = 'Hi Priya,\n\nEdited by hand.\n\nThanks,\nJob Tester';
    const res = await request(app)
      .put(`/api/v1/jobs/${jobId}/draft`)
      .set('Cookie', cookie)
      .send({ subject: 'Edited subject', bodyText });
    expect(res.status).toBe(200);
    expect(res.body.job.draft.subject).toBe('Edited subject');
    expect(res.body.job.draft.bodyText).toBe(bodyText);
    expect(res.body.job.draft.bodyHtml).toBe(emailBodyToHtml(bodyText));
    expect(res.body.job.status).toBe('email_drafted');
  });

  it('rejects an empty update', async () => {
    const res = await request(app)
      .put(`/api/v1/jobs/${jobId}/draft`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('regenerates with a new tone when tone is provided (reusing the stored match)', async () => {
    lastEmailInput = null;
    const callsBefore = analyzeCalls;
    mockDraft = { ...draftFixture, subject: 'Application: Backend Engineer, friendly' };

    const res = await request(app)
      .put(`/api/v1/jobs/${jobId}/draft`)
      .set('Cookie', cookie)
      .send({ tone: 'friendly' });
    expect(res.status).toBe(200);
    expect(res.body.job.draft.subject).toBe('Application: Backend Engineer, friendly');

    // Tone reached the provider; match was reused, not re-analyzed.
    expect(lastEmailInput).not.toBeNull();
    expect(lastEmailInput!.tone).toBe('friendly');
    expect(analyzeCalls).toBe(callsBefore);
    mockDraft = draftFixture;
  });
});

describe('emailRules', () => {
  it('detects banned phrases', () => {
    expect(findBannedPhrases('I hope this email finds you well.')).toHaveLength(1);
    expect(findBannedPhrases('I am writing to express my keen interest in the role.')).toHaveLength(
      1,
    );
    expect(findBannedPhrases('your esteemed organization')).toHaveLength(1);
    expect(findBannedPhrases('as per your requirements, here is my resume')).toHaveLength(1);
    expect(findBannedPhrases('Your Node.js opening caught my eye.')).toHaveLength(0);
  });

  it('flags over-cap subject and body, and generic subjects', () => {
    const longSubject = 'one two three four five six seven eight';
    const longBody = Array(181).fill('word').join(' ');
    expect(validateOutreachEmail({ subject: longSubject, bodyText: 'short body' })).toHaveLength(1);
    expect(validateOutreachEmail({ subject: 'OK subject', bodyText: longBody })).toHaveLength(1);
    expect(validateOutreachEmail({ subject: 'Job application', bodyText: 'fine' })).toHaveLength(1);
    expect(
      validateOutreachEmail({ subject: 'Application: Backend Engineer', bodyText: 'fine' }),
    ).toEqual([]);
  });

  it('repairs: strips banned phrases, truncates caps, rebuilds HTML', () => {
    const repaired = repairOutreachEmail({
      subject: 'one two three four five six seven eight nine',
      bodyText:
        'I hope this finds you well. Your Node.js opening caught my eye.\n\nI shipped production systems.',
      bodyHtml: '',
    });
    expect(countWords(repaired.subject)).toBeLessThanOrEqual(7);
    expect(findBannedPhrases(repaired.bodyText)).toHaveLength(0);
    expect(repaired.bodyText).toContain('Your Node.js opening caught my eye.');
    expect(repaired.bodyHtml).toContain('<p>');
    expect(validateOutreachEmail(repaired)).toEqual([]);
  });
});

describe('heuristic fallback (no API key path)', () => {
  const profile = {
    fullName: 'Job Tester',
    headline: 'Backend Engineer',
    yearsExp: 5,
    skills: ['Node.js', 'MongoDB'],
    summary: 'Backend engineer shipping Node.js services.',
    resumeText: 'Built Node.js and MongoDB services at scale.',
    phone: '+91 90000 00000',
    links: { linkedin: 'https://linkedin.com/in/jobtester', github: '', portfolio: 'https://jobtester.dev' },
    signature: '',
  };

  it('scores skill overlap between jdText and the profile', () => {
    const match = analyzeMatchHeuristic({
      jdText: 'We need Node.js, MongoDB and Kubernetes experience.',
      role: 'Backend Engineer',
      company: 'Acme',
      profile,
    });
    expect(match.matchedSkills).toContain('Node.js');
    expect(match.matchedSkills).toContain('MongoDB');
    expect(match.gaps).toContain('Kubernetes');
    expect(match.score).toBeGreaterThan(0);
    expect(match.score).toBeLessThanOrEqual(100);
    expect(match.angle).toContain('Node.js');
  });

  it('generates a template email that passes every hard rule', () => {
    const draft = generateEmailFromTemplate({
      extraction: {
        company: 'Acme',
        role: 'Backend Engineer',
        location: 'Bengaluru',
        jdText: 'We need Node.js and MongoDB experience.',
        hrName: 'Priya Sharma',
      },
      match: analyzeMatchHeuristic({
        jdText: 'We need Node.js and MongoDB experience.',
        role: 'Backend Engineer',
        company: 'Acme',
        profile,
      }),
      profile,
      tone: 'formal',
    });
    expect(validateOutreachEmail(draft)).toEqual([]);
    expect(countWords(draft.subject)).toBeLessThanOrEqual(7);
    expect(countWords(draft.bodyText)).toBeLessThanOrEqual(180);
    expect(draft.bodyText).toContain('Node.js'); // JD-specific hook
    expect(draft.bodyText).toContain('15-minute call'); // soft CTA
    expect(draft.bodyText).toContain('https://linkedin.com/in/jobtester'); // signature block
    expect(draft.bodyHtml).toContain('<ul>');
  });
});
