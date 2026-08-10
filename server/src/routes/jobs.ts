import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import {
  draftUpdateSchema,
  ErrorCodes,
  extractionUpdateSchema,
  generateEmailSchema,
  importJobSchema,
  LOW_MATCH_THRESHOLD,
  RECENT_CONTACT_WINDOW_DAYS,
  sendJobSchema,
  type DraftUpdateInput,
  type GenerateEmailInput,
  type ImportJobInput,
  type JobPostResponse,
  type JobPostSummary,
  type OutreachProfileSnapshot,
  type RecentContactInfo,
  type SendJobInput,
  type SendJobResponse,
  type TemplateGuidance,
  type Tone,
  type UploadJobResponse,
} from '@jobmail/shared';
import { JobPost, type IJobPost } from '../models/JobPost';
import { Application } from '../models/Application';
import { Profile, type IProfile } from '../models/Profile';
import { EmailTemplate, type IEmailTemplate } from '../models/EmailTemplate';
import { User } from '../models/User';
import { AppError } from '../middleware/error';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { generateLimiter, sendLimiter, uploadLimiter } from '../middleware/rateLimit';
import { runExtraction, runTextExtraction } from '../services/extractionRunner';
import { scheduleSendEmail } from '../services/queue';
import { getAIProvider } from '../services/ai/provider';
import { emailBodyToHtml } from '../services/emailRules';
import { sniffImageMime } from '../utils/imageMime';
import { hasMxRecord, isValidEmail } from '../utils/emailValidation';
import { computeDedupeHash } from '../utils/dedupe';

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads/screenshots');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // No extension on purpose: the real type is sniffed from magic bytes at
    // serve time, so a misleading original extension can never confuse us.
    filename: (_req, _file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First gate: declared MIME. Real sniffing happens on the saved file.
    if (!file.mimetype.startsWith('image/')) {
      cb(new AppError(400, ErrorCodes.BAD_REQUEST, 'Only image files are accepted'));
      return;
    }
    cb(null, true);
  },
});

function toDto(job: IJobPost): JobPostResponse {
  return {
    id: String(job._id),
    status: job.status,
    needsEmail: job.needsEmail,
    hrEmail: job.hrEmail,
    extraction: job.extraction,
    rawExtractedText: job.rawExtractedText,
    draft: job.draft,
    match: job.match,
    lowMatch: job.match !== null && job.match.score < LOW_MATCH_THRESHOLD,
    dedupeHash: job.dedupeHash,
    error: job.error,
    failureCode: job.failureCode,
    templateId: job.templateId ? String(job.templateId) : null,
    sourceUrl: job.sourceUrl,
    hasScreenshot: Boolean(job.screenshotPath),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toSummary(job: IJobPost): JobPostSummary {
  return {
    id: String(job._id),
    status: job.status,
    needsEmail: job.needsEmail,
    company: job.extraction?.company ?? null,
    role: job.extraction?.role ?? null,
    hrEmail: job.hrEmail,
    source: job.extraction?.source ?? null,
    confidence: job.extraction?.confidence ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

async function findOwnJob(userId: string, id: string): Promise<IJobPost> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Job not found');
  }
  const job = await JobPost.findOne({ _id: id, userId });
  if (!job) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Job not found');
  return job;
}

/**
 * Screenshot upload → async extraction (SPEC §6). The JobPost is created in
 * 'processing' state and the client polls GET /jobs/:id until the status
 * flips. runExtraction is fire-and-forget today; M3 moves it onto Agenda
 * without changing the route contract.
 */
jobsRouter.post('/upload', uploadLimiter, upload.single('screenshot'), async (req, res, next) => {
  const cleanup = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => undefined);
  };
  try {
    if (!req.file) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'No file uploaded (field: screenshot)');
    }

    const head = Buffer.alloc(12);
    const fd = await fs.promises.open(req.file.path, 'r');
    await fd.read(head, 0, 12, 0);
    await fd.close();
    if (!sniffImageMime(head)) {
      cleanup();
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'File is not a valid image (png/jpeg/webp)');
    }

    const job = await JobPost.create({
      userId: req.userId!,
      screenshotPath: req.file.path,
      status: 'processing',
    });

    // Fire-and-forget: runExtraction handles and persists its own errors.
    void runExtraction(String(job._id));

    const body: UploadJobResponse = { jobPostId: String(job._id) };
    res.status(202).json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * Pasted job description → async extraction (Phase 2). Mirrors /upload
 * exactly, with a text source instead of a screenshot: the JobPost is
 * created in 'processing' state (pasted text parked in rawExtractedText),
 * the client polls GET /jobs/:id until the status flips, and duplicates
 * surface the same way (extraction-time → status 'failed').
 *
 * `sourceUrl` is stored as a reference link only — it is NEVER fetched
 * server-side (SSRF).
 */
jobsRouter.post('/import', uploadLimiter, validate(importJobSchema), async (req, res, next) => {
  try {
    const input = req.body as ImportJobInput;

    const job = await JobPost.create({
      userId: req.userId!,
      rawExtractedText: input.rawText,
      sourceUrl: input.sourceUrl ?? null,
      status: 'processing',
    });

    // Fire-and-forget: runTextExtraction handles and persists its own errors.
    void runTextExtraction(String(job._id));

    const body: UploadJobResponse = { jobPostId: String(job._id) };
    res.status(202).json(body);
  } catch (err) {
    next(err);
  }
});

jobsRouter.get('/', async (req, res, next) => {
  try {
    const jobs = await JobPost.find({ userId: req.userId! }).sort({ createdAt: -1 }).limit(100);
    res.json({ jobs: jobs.map(toSummary) });
  } catch (err) {
    next(err);
  }
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Double-outreach guard (Phase 4) — NON-BLOCKING, informational only.
 * Was this job's chosen HR email already sent an email within the last
 * 14 days on a DIFFERENT application? Returns the most recent such contact.
 * One indexed query (userId + emails.sentAt), skipped when the job has no
 * candidate email. Never gates the send pipeline.
 */
async function findRecentContact(
  userId: string,
  job: IJobPost,
): Promise<RecentContactInfo | null> {
  if (!job.hrEmail) return null;
  const since = new Date(Date.now() - RECENT_CONTACT_WINDOW_DAYS * DAY_MS);
  const candidates = await Application.find({
    userId,
    hrEmail: job.hrEmail,
    jobPostId: { $ne: job._id },
    'emails.sentAt': { $gte: since },
  }).select('company emails.sentAt');

  let latest: { sentAt: Date; company: string | null } | null = null;
  for (const application of candidates) {
    for (const email of application.emails) {
      if (email.sentAt && email.sentAt >= since && (!latest || email.sentAt > latest.sentAt)) {
        latest = { sentAt: email.sentAt, company: application.company };
      }
    }
  }
  if (!latest) return null;
  return {
    email: job.hrEmail,
    daysAgo: Math.floor((Date.now() - latest.sentAt.getTime()) / DAY_MS),
    company: latest.company,
  };
}

jobsRouter.get('/:id', async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    // recentContact rides on this DTO only — the review flow and ProofSheet
    // both consume GET /jobs/:id, so one computation covers both surfaces.
    const recentContact = await findRecentContact(req.userId!, job);
    res.json({ job: { ...toDto(job), recentContact } });
  } catch (err) {
    next(err);
  }
});

/** Authenticated screenshot serving — uploads live outside the web root (SPEC §8). */
jobsRouter.get('/:id/screenshot', async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    // Pasted-text imports have no screenshot on disk.
    if (!job.screenshotPath) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Screenshot not found');
    }
    const head = Buffer.alloc(12);
    const fd = await fs.promises.open(job.screenshotPath, 'r');
    await fd.read(head, 0, 12, 0);
    await fd.close();
    const mime = sniffImageMime(head);
    if (!mime) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Screenshot not found');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(job.screenshotPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * User corrections on the review screen (SPEC §9 edge cases 1/2/10):
 * fix extracted fields, pick or paste the HR email. A new/changed email is
 * MX-revalidated and the dedupe hash recomputed — duplicates surface here as
 * a friendly 409 pointing at the existing application.
 */
jobsRouter.put('/:id/extraction', validate(extractionUpdateSchema), async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    const input = req.body as {
      company?: string | null;
      role?: string | null;
      location?: string | null;
      hrName?: string | null;
      hrEmail?: string | null;
    };

    if (!job.extraction) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Extraction has not completed yet');
    }

    if (input.company !== undefined) job.extraction.company = input.company;
    if (input.role !== undefined) job.extraction.role = input.role;
    if (input.location !== undefined) job.extraction.location = input.location;
    if (input.hrName !== undefined) job.extraction.hrName = input.hrName;

    if (input.hrEmail !== undefined) {
      if (input.hrEmail === null) {
        job.hrEmail = null;
        job.needsEmail = true;
        job.dedupeHash = null;
      } else {
        const email = input.hrEmail.trim().toLowerCase();
        if (!isValidEmail(email)) {
          throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid email address');
        }
        const domain = email.split('@')[1];
        if (!(await hasMxRecord(domain))) {
          throw new AppError(
            400,
            ErrorCodes.VALIDATION_ERROR,
            `No mail server found for domain "${domain}" — check the address`,
          );
        }
        job.hrEmail = email;
        job.needsEmail = false;
        // Manual entries rank top-confidence and join the ranked list if new.
        if (!job.extraction.hrEmails.some((e) => e.email === email)) {
          job.extraction.hrEmails.unshift({ email, confidence: 1 });
        }
      }
    }

    if (job.hrEmail) {
      job.dedupeHash = computeDedupeHash(
        req.userId!,
        job.hrEmail,
        job.extraction.company,
        job.extraction.role,
      );
      const duplicate = await JobPost.findOne({
        userId: req.userId!,
        dedupeHash: job.dedupeHash,
        _id: { $ne: job._id },
      });
      if (duplicate) {
        throw new AppError(
          409,
          ErrorCodes.DUPLICATE_APPLICATION,
          'You already have an application for this HR contact, company and role',
          { existingJobPostId: String(duplicate._id) },
        );
      }
    }

    // Corrections mean a human reviewed it: recover from needs_review/failed.
    if (['processing', 'needs_review', 'failed'].includes(job.status)) {
      job.status = 'extracted';
    }
    job.error = null;
    await job.save();
    res.json({ job: toDto(job) });
  } catch (err) {
    next(err);
  }
});

/* ── M3: match analysis + outreach email generation ─────────────── */

function profileSnapshot(profile: IProfile): OutreachProfileSnapshot {
  return {
    fullName: profile.fullName,
    headline: profile.headline,
    yearsExp: profile.yearsExp,
    skills: profile.skills,
    summary: profile.summary,
    resumeText: profile.resumeFile?.parsedText ?? '',
    phone: profile.phone,
    links: {
      linkedin: profile.links.linkedin,
      github: profile.links.github,
      portfolio: profile.links.portfolio,
    },
    signature: profile.signature,
  };
}

/** Preconditions shared by generate-email and tone regeneration. */
function assertDraftable(job: IJobPost): asserts job is IJobPost & { extraction: NonNullable<IJobPost['extraction']> } {
  if (!job.extraction || ['processing', 'failed'].includes(job.status)) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Extraction has not completed yet');
  }
}

async function requireProfile(userId: string): Promise<IProfile> {
  const profile = await Profile.findOne({ userId });
  if (!profile) {
    throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Complete your profile before generating emails');
  }
  return profile;
}

async function userTone(userId: string): Promise<Tone> {
  const user = await User.findById(userId).select('settings');
  return user?.settings.tone ?? 'formal';
}

/**
 * Resolve the template for a generation run (SPEC §4 Step C "template (or
 * default)"): an explicit id (ownership-checked) wins, otherwise the user's
 * default template, otherwise null (freehand generation).
 */
async function resolveTemplate(userId: string, templateId?: string): Promise<IEmailTemplate | null> {
  if (templateId) {
    const template = await EmailTemplate.findOne({ _id: templateId, userId });
    if (!template) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Template not found');
    return template;
  }
  return EmailTemplate.findOne({ userId, isDefault: true });
}

function templateGuidance(template: IEmailTemplate | null): TemplateGuidance | null {
  if (!template) return null;
  return {
    name: template.name,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
  };
}

/**
 * Run match analysis + email generation and persist both on the job.
 * Reuses an existing match when one is already stored (tone switch),
 * otherwise analyzes fresh. The resolved template steers the draft and its
 * id is stored on the job (copied to the Application at send time, M5).
 */
async function generateDraft(
  job: IJobPost,
  profile: IProfile,
  tone: Tone,
  template: IEmailTemplate | null,
): Promise<void> {
  assertDraftable(job);
  const provider = getAIProvider();
  const snapshot = profileSnapshot(profile);

  const match =
    job.match ??
    (await provider.analyzeMatch({
      jdText: job.extraction.jdText,
      role: job.extraction.role,
      company: job.extraction.company,
      profile: snapshot,
    }));

  const draft = await provider.generateOutreachEmail({
    extraction: {
      company: job.extraction.company,
      role: job.extraction.role,
      location: job.extraction.location,
      jdText: job.extraction.jdText,
      hrName: job.extraction.hrName,
    },
    match,
    profile: snapshot,
    tone,
    template: templateGuidance(template),
  });

  job.match = match;
  job.draft = draft;
  job.templateId = template?._id ?? null;
  job.status = 'email_drafted';
  job.error = null;
  await job.save();
}

/**
 * POST /jobs/:id/generate-email (SPEC §4 Steps B+C): match analysis +
 * outreach draft in one shot. Requires a completed extraction, an HR email,
 * and an existing profile. Optional body { templateId } picks a template
 * (default: the user's default template, if any). Rate-limited (30/hour) —
 * it costs AI calls.
 */
jobsRouter.post('/:id/generate-email', generateLimiter, validate(generateEmailSchema), async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    assertDraftable(job);
    if (job.needsEmail || !job.hrEmail) {
      throw new AppError(
        400,
        ErrorCodes.BAD_REQUEST,
        'Set an HR email before generating the outreach email',
      );
    }
    const input = req.body as GenerateEmailInput;
    const profile = await requireProfile(req.userId!);
    const template = await resolveTemplate(req.userId!, input.templateId);
    await generateDraft(job, profile, await userTone(req.userId!), template);
    res.json({ job: toDto(job) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /jobs/:id/draft — two modes (SPEC §5 review screen):
 * - { subject?, bodyText?, bodyHtml? } → save the user's edits as-is.
 * - { tone } → regenerate the email with that tone (UI tone switcher).
 */
jobsRouter.put('/:id/draft', validate(draftUpdateSchema), async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    const input = req.body as DraftUpdateInput;

    if (input.tone !== undefined) {
      const profile = await requireProfile(req.userId!);
      // Tone regeneration keeps the template chosen for this job, if any.
      const template = job.templateId
        ? await EmailTemplate.findOne({ _id: job.templateId, userId: req.userId! })
        : null;
      await generateDraft(job, profile, input.tone, template);
      res.json({ job: toDto(job) });
      return;
    }

    if (input.subject !== undefined) job.draft.subject = input.subject;
    if (input.bodyText !== undefined) {
      job.draft.bodyText = input.bodyText;
      // Keep HTML in sync unless the caller explicitly provided it.
      if (input.bodyHtml === undefined) job.draft.bodyHtml = emailBodyToHtml(input.bodyText);
    }
    if (input.bodyHtml !== undefined) job.draft.bodyHtml = input.bodyHtml;

    await job.save();
    res.json({ job: toDto(job) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /jobs/:id/send (SPEC §5/§6) — human approval happened by clicking
 * send, so this enqueues immediately regardless of settings.autoSend (which
 * only gates future UI auto-flows). The queue applies jitter + send caps;
 * MX was already re-validated when the HR email was saved via PUT /extraction.
 */
jobsRouter.post('/:id/send', sendLimiter, validate(sendJobSchema), async (req, res, next) => {
  try {
    const job = await findOwnJob(req.userId!, req.params.id);
    const input = req.body as SendJobInput;

    // Sending gate (email verification): the app sends on the user's behalf, so
    // an unverified address is a deliverability/abuse risk — fail closed here.
    const owner = await User.findById(req.userId!).select('emailVerified');
    if (!owner?.emailVerified) {
      throw new AppError(
        403,
        ErrorCodes.EMAIL_NOT_VERIFIED,
        'Verify your email to start sending',
      );
    }

    if (job.needsEmail || !job.hrEmail) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Set an HR email before sending');
    }
    if (!job.draft.subject.trim() || !job.draft.bodyText.trim()) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Generate or write the email draft before sending');
    }
    const requestedAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;

    // Atomic guard: prevent a double-send if two requests race. Only one
    // transaction can flip the status from a non-terminal state to 'queued'.
    const queued = await JobPost.findOneAndUpdate(
      { _id: job._id, userId: req.userId!, status: { $nin: ['queued', 'sent'] } },
      { $set: { status: 'queued', error: null, failureCode: null } },
      { new: true },
    );
    if (!queued) {
      throw new AppError(
        409,
        ErrorCodes.CONFLICT,
        'This application is already queued or sent',
      );
    }

    const { scheduledAt } = await scheduleSendEmail(String(job._id), req.userId!, requestedAt);
    const body: SendJobResponse = { queued: true, scheduledAt: scheduledAt.toISOString() };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
