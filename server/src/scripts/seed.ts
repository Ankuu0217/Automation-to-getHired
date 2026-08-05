/**
 * Seed script (SPEC §10) — demo dataset for local development.
 *
 * Creates the demo user (demo@jobmail.dev / Demo1234!) with a filled profile,
 * two email templates, and six applications across every Kanban stage — each
 * with a JobPost (extraction + match populated), a realistic email thread
 * spread over the last 30 days, and matching EmailEvent docs so the analytics
 * funnel, 30-day trend, per-template stats and Kanban board all show data.
 *
 * Idempotent: the demo user's existing data is wiped first. Screenshot files
 * use deterministic names, so re-runs overwrite rather than accumulate.
 * No Gmail/Gemini credentials are needed — this only writes to MongoDB.
 *
 * Run from the repo root: `pnpm seed` (connects via server env MONGODB_URI).
 */
import path from 'node:path';
import fs from 'node:fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import type { ApplicationStage } from '@jobmail/shared';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { JobPost } from '../models/JobPost';
import { Application, type IApplicationEmail } from '../models/Application';
import { EmailTemplate } from '../models/EmailTemplate';
import { EmailEvent } from '../models/EmailEvent';

const BCRYPT_COST = 12; // same as routes/auth.ts

const DEMO_EMAIL = 'demo@jobmail.dev';
const DEMO_PASSWORD = 'Demo1234!';
const DEMO_NAME = 'Demo User';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCREENSHOT_DIR = path.resolve(__dirname, '../../uploads/screenshots');

// 1×1 transparent PNG — placeholder so the authenticated screenshot route works.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function daysAgo(days: number, hour = 10): Date {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(hour, 15, 0, 0);
  return d;
}

interface SeedJob {
  stage: ApplicationStage;
  company: string;
  role: string;
  location: string;
  hrName: string;
  hrEmail: string;
  jdText: string;
  matchScore: number;
  matchedSkills: string[];
  gaps: string[];
  angle: string;
  /** Days ago the initial email was sent. */
  sentDaysAgo: number;
  /** Number of follow-ups actually sent (0–2). */
  followUpsSent: number;
  opened: boolean;
  replied: boolean;
  /** Leave pending (unsent, scheduled) follow-up subdocs — Kanban countdowns. */
  pendingFollowUps?: number;
  useSecondTemplate?: boolean;
}

const SEED_JOBS: SeedJob[] = [
  {
    stage: 'applied',
    company: 'Nimbus Labs',
    role: 'Full-Stack Engineer',
    location: 'Remote (India)',
    hrName: 'Ananya Iyer',
    hrEmail: 'ananya.iyer@nimbuslabs.io',
    jdText:
      'Nimbus Labs is hiring a Full-Stack Engineer to build our analytics dashboard. ' +
      'You will work across our React frontend and Node.js/TypeScript services, ship features ' +
      'end-to-end, and help shape our MongoDB data models. 3+ years of experience required.',
    matchScore: 88,
    matchedSkills: ['TypeScript', 'React', 'Node.js', 'MongoDB'],
    gaps: ['GraphQL'],
    angle: 'Direct match on the TypeScript/React/Node stack with production MongoDB experience',
    sentDaysAgo: 2,
    followUpsSent: 0,
    opened: false,
    replied: false,
    pendingFollowUps: 2,
  },
  {
    stage: 'hr_screen',
    company: 'FinEdge',
    role: 'Backend Engineer, Payments',
    location: 'Bengaluru (Hybrid)',
    hrName: 'Rohit Malhotra',
    hrEmail: 'rohit.malhotra@finedge.com',
    jdText:
      'FinEdge is looking for a Backend Engineer to scale our payments platform. You will design ' +
      'idempotent transaction APIs in Node.js, own queue-based settlement pipelines, and work ' +
      'closely with the risk team. Experience with MongoDB or another document store is a plus.',
    matchScore: 84,
    matchedSkills: ['Node.js', 'MongoDB', 'REST APIs', 'Redis'],
    gaps: ['Kafka'],
    angle: 'Payments-grade API design experience with queues and document stores',
    sentDaysAgo: 9,
    followUpsSent: 0,
    opened: true,
    replied: true,
  },
  {
    stage: 'interview',
    company: 'Craftly',
    role: 'Senior Product Engineer',
    location: 'Pune (Remote-first)',
    hrName: 'Sara D’Souza',
    hrEmail: 'sara.dsouza@craftly.app',
    jdText:
      'Craftly is a marketplace for independent makers. As a Senior Product Engineer you will own ' +
      'seller-facing tooling across the stack — React, TypeScript, Express and MongoDB — and drive ' +
      'projects from spec to launch. We value pragmatism and strong written communication.',
    matchScore: 91,
    matchedSkills: ['TypeScript', 'React', 'Express', 'MongoDB', 'AWS'],
    gaps: [],
    angle: 'End-to-end product ownership on the exact stack the role lists',
    sentDaysAgo: 16,
    followUpsSent: 1,
    opened: true,
    replied: true,
  },
  {
    stage: 'offer',
    company: 'Orbital Health',
    role: 'Platform Engineer',
    location: 'Hyderabad',
    hrName: 'Vikram Rao',
    hrEmail: 'vikram.rao@orbitalhealth.in',
    jdText:
      'Orbital Health is modernising hospital operations software. The Platform Engineer role owns ' +
      'our internal services in Node.js and TypeScript, our MongoDB clusters, and CI/CD on AWS. ' +
      'Healthcare domain experience is welcome but not required.',
    matchScore: 86,
    matchedSkills: ['Node.js', 'TypeScript', 'MongoDB', 'AWS', 'Docker'],
    gaps: ['Kubernetes'],
    angle: 'Platform ownership experience — services, data stores and deploy pipelines',
    sentDaysAgo: 24,
    followUpsSent: 2,
    opened: true,
    replied: true,
    useSecondTemplate: true,
  },
  {
    stage: 'rejected',
    company: 'Brightcart',
    role: 'Frontend Engineer',
    location: 'Gurugram',
    hrName: 'Meera Kapoor',
    hrEmail: 'meera.kapoor@brightcart.com',
    jdText:
      'Brightcart is hiring a Frontend Engineer for our storefront team. Deep React expertise, ' +
      'design-system experience and a sharp eye for performance budgets are must-haves. You will ' +
      'partner with design on our component library used by 40+ engineers.',
    matchScore: 72,
    matchedSkills: ['React', 'TypeScript', 'CSS'],
    gaps: ['Design systems at scale'],
    angle: 'Strong React/TypeScript fundamentals with performance work to point at',
    sentDaysAgo: 18,
    followUpsSent: 2,
    opened: true,
    replied: false,
  },
  {
    stage: 'ghosted',
    company: 'Dataweave Systems',
    role: 'Software Engineer II',
    location: 'Remote',
    hrName: 'Karthik Menon',
    hrEmail: 'karthik.menon@dataweave.dev',
    jdText:
      'Dataweave Systems builds data-quality tooling for mid-market teams. We are looking for a ' +
      'Software Engineer II to work on ingestion workers (Node.js), rule engines and our MongoDB ' +
      'backed metadata store. Small team, high ownership.',
    matchScore: 79,
    matchedSkills: ['Node.js', 'MongoDB', 'TypeScript'],
    gaps: ['Python'],
    angle: 'Worker/queue systems experience plus the listed Node.js/MongoDB core',
    sentDaysAgo: 27,
    followUpsSent: 2,
    opened: false,
    replied: false,
    useSecondTemplate: true,
  },
];

function initialBody(job: SeedJob): string {
  return (
    `Hi ${job.hrName.split(' ')[0]},\n\n` +
    `I came across the ${job.role} opening at ${job.company} and it lines up closely with what ` +
    `I've been doing — ${job.matchedSkills.slice(0, 3).join(', ')} in production for the last few years.\n\n` +
    `I'd love to share how my experience maps onto the role. My resume is attached; happy to ` +
    `jump on a quick call whenever suits.\n\n` +
    `Best,\n${DEMO_NAME}`
  );
}

function followUpBody(job: SeedJob, sequence: 1 | 2): string {
  const firstName = job.hrName.split(' ')[0];
  const nudge =
    sequence === 1
      ? `Just following up on my application for the ${job.role} role at ${job.company} — I'm still very interested and glad to share anything else that would help. My resume is attached to my first email.`
      : `One last note on my application for the ${job.role} role at ${job.company}. If the timing isn't right, no worries — I'd still welcome a short chat whenever suits. Thank you for your time.`;
  return `Hi ${firstName},\n\n${nudge}\n\nBest,\n${DEMO_NAME}`;
}

/** Build the email thread subdocs + tracking events for one seeded job. */
function buildThread(job: SeedJob): { emails: IApplicationEmail[]; events: Array<{ kind: 'open' | 'reply'; createdAt: Date; meta: Record<string, unknown> }> } {
  const emails: IApplicationEmail[] = [];
  const events: Array<{ kind: 'open' | 'reply'; createdAt: Date; meta: Record<string, unknown> }> = [];
  const subject = `Application: ${job.role} — ${DEMO_NAME}`;
  const sentAt = daysAgo(job.sentDaysAgo);

  emails.push({
    subject,
    bodyText: initialBody(job),
    bodyHtml: '',
    kind: 'initial',
    scheduledAt: sentAt,
    sentAt,
    openedAt: job.opened ? daysAgo(job.sentDaysAgo - 1, 9) : null,
    repliedAt: job.replied ? daysAgo(Math.max(job.sentDaysAgo - 2, 0), 14) : null,
    bouncedAt: null,
    messageId: `<seed-${job.company.toLowerCase().replace(/[^a-z0-9]/g, '')}-1@mail.gmail.com>`,
    cancelledAt: null,
  });

  for (let i = 1; i <= job.followUpsSent; i += 1) {
    const fuSentAt = daysAgo(Math.max(job.sentDaysAgo - (i === 1 ? 3 : 7), 0), 11);
    emails.push({
      subject: `Re: ${subject}`,
      bodyText: followUpBody(job, i === 1 ? 1 : 2),
      bodyHtml: '',
      kind: i === 1 ? 'followup_1' : 'followup_2',
      scheduledAt: fuSentAt,
      sentAt: fuSentAt,
      openedAt: job.opened && i === 1 ? daysAgo(Math.max(job.sentDaysAgo - 4, 0), 16) : null,
      repliedAt: null,
      bouncedAt: null,
      messageId: `<seed-${job.company.toLowerCase().replace(/[^a-z0-9]/g, '')}-${i + 1}@mail.gmail.com>`,
      cancelledAt: null,
    });
  }

  // Pending follow-ups (applied stage) — scheduled, unsent, never cancelled.
  for (let i = 1; i <= (job.pendingFollowUps ?? 0); i += 1) {
    emails.push({
      subject: `Re: ${subject}`,
      bodyText: followUpBody(job, i === 1 ? 1 : 2),
      bodyHtml: '',
      kind: i === 1 ? 'followup_1' : 'followup_2',
      scheduledAt: new Date(sentAt.getTime() + (i === 1 ? 3 : 7) * DAY_MS),
      sentAt: null,
      openedAt: null,
      repliedAt: null,
      bouncedAt: null,
      messageId: null,
      cancelledAt: null,
    });
  }

  if (job.opened) {
    events.push({ kind: 'open', createdAt: daysAgo(job.sentDaysAgo - 1, 9), meta: { emailIndex: 0 } });
    events.push({ kind: 'open', createdAt: daysAgo(job.sentDaysAgo - 1, 18), meta: { emailIndex: 0 } });
  }
  if (job.replied) {
    events.push({
      kind: 'reply',
      createdAt: daysAgo(Math.max(job.sentDaysAgo - 2, 0), 14),
      meta: { emailIndex: 0, manual: true },
    });
  }
  return { emails, events };
}

/** Wipe everything the demo user owns (mirrors DELETE /auth/account). */
async function wipeDemoUser(userId: mongoose.Types.ObjectId): Promise<void> {
  const applicationIds = (await Application.find({ userId }).select('_id').lean()).map((a) => a._id);
  await Promise.all([
    EmailEvent.deleteMany({ applicationId: { $in: applicationIds } }),
    Application.deleteMany({ userId }),
    JobPost.deleteMany({ userId }),
    EmailTemplate.deleteMany({ userId }),
    Profile.deleteOne({ userId }),
    User.deleteOne({ _id: userId }),
  ]);
  logger.info('Existing demo user data wiped');
}

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  logger.info({ uri: env.MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@') }, 'Connected to MongoDB');

  const existing = await User.findOne({ email: DEMO_EMAIL }).select('_id').lean();
  if (existing) await wipeDemoUser(existing._id);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
  const user = await User.create({ name: DEMO_NAME, email: DEMO_EMAIL, passwordHash });

  await Profile.create({
    userId: user._id,
    fullName: DEMO_NAME,
    headline: 'Full-Stack Engineer · TypeScript, React, Node.js',
    location: 'Bengaluru, India',
    yearsExp: 5,
    skills: ['TypeScript', 'React', 'Node.js', 'Express', 'MongoDB', 'Redis', 'AWS', 'Docker'],
    links: {
      linkedin: 'https://linkedin.com/in/demo-user',
      github: 'https://github.com/demo-user',
      portfolio: 'https://demo-user.dev',
    },
    summary:
      'Full-stack engineer with 5 years of experience shipping web products end-to-end. ' +
      'Most at home in TypeScript across React frontends and Node.js services backed by MongoDB. ' +
      'Recently built a real-time analytics pipeline handling 2M events/day and led the migration ' +
      'of a legacy monolith to modular Express services.',
    signature: `Best,\n${DEMO_NAME}\nhttps://demo-user.dev`,
    preferredRoles: ['Full-Stack Engineer', 'Backend Engineer', 'Product Engineer'],
    noticePeriod: '30 days',
  });

  const defaultTemplate = await EmailTemplate.create({
    userId: user._id,
    name: 'Formal Outreach',
    tone: 'formal',
    subjectTemplate: 'Application: {{role}} — {{candidateName}}',
    bodyTemplate:
      'Dear {{hrName}},\n\nI am writing regarding the {{role}} position at {{company}}. ' +
      'My background in {{skills}} aligns closely with the role.\n\nBest regards,\n{{candidateName}}',
    isDefault: true,
    stats: { sent: 9, opened: 6, replied: 3 },
  });
  const friendlyTemplate = await EmailTemplate.create({
    userId: user._id,
    name: 'Friendly Intro',
    tone: 'friendly',
    subjectTemplate: '{{role}} at {{company}} — quick intro',
    bodyTemplate:
      'Hi {{hrName}},\n\nLoved what {{company}} is building! The {{role}} role looks like a ' +
      'great fit for my {{skills}} experience.\n\nCheers,\n{{candidateName}}',
    isDefault: false,
    stats: { sent: 4, opened: 2, replied: 1 },
  });

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  for (const job of SEED_JOBS) {
    const slug = job.company.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const screenshotPath = path.join(SCREENSHOT_DIR, `seed-${slug}.png`);
    fs.writeFileSync(screenshotPath, TINY_PNG);
    const template = job.useSecondTemplate ? friendlyTemplate : defaultTemplate;
    const sentAt = daysAgo(job.sentDaysAgo);

    const jobPost = await JobPost.create({
      userId: user._id,
      screenshotPath,
      rawExtractedText: job.jdText,
      extraction: {
        company: job.company,
        role: job.role,
        location: job.location,
        jdText: job.jdText,
        hrName: job.hrName,
        hrEmails: [{ email: job.hrEmail, confidence: 0.9 }],
        source: 'vision',
        confidence: 0.92,
      },
      status: 'sent',
      needsEmail: false,
      hrEmail: job.hrEmail,
      dedupeHash: `seed-${slug}`,
      draft: {
        subject: `Application: ${job.role} — ${DEMO_NAME}`,
        bodyText: initialBody(job),
        bodyHtml: '',
      },
      match: {
        score: job.matchScore,
        matchedSkills: job.matchedSkills,
        gaps: job.gaps,
        angle: job.angle,
      },
      templateId: template._id,
      createdAt: new Date(sentAt.getTime() - 60 * 60 * 1000),
    });

    const { emails, events } = buildThread(job);
    const application = await Application.create({
      userId: user._id,
      jobPostId: jobPost._id,
      hrEmail: job.hrEmail,
      hrName: job.hrName,
      company: job.company,
      role: job.role,
      stage: job.stage,
      templateId: template._id,
      emails,
      notes: job.stage === 'interview' ? 'Second round scheduled — systems design focus.' : '',
      createdAt: sentAt,
    });

    await EmailEvent.insertMany(
      events.map((e) => ({ applicationId: application._id, kind: e.kind, meta: e.meta, createdAt: e.createdAt })),
    );
  }

  logger.info(
    { applications: SEED_JOBS.length, templates: 2 },
    'Seed complete',
  );
  // eslint-disable-next-line no-console
  console.log(`\n✅ Demo data seeded.\n   Login:    ${DEMO_EMAIL}\n   Password: ${DEMO_PASSWORD}\n`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Seed failed');
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
