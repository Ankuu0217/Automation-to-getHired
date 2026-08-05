import fs from 'node:fs';
import type { JobExtraction } from '@jobmail/shared';
import { JobPost, type IJobPost } from '../models/JobPost';
import { getAIProvider } from './ai/provider';
import { validateAndRankEmails } from '../utils/emailValidation';
import { computeDedupeHash } from '../utils/dedupe';
import { sniffImageMime } from '../utils/imageMime';
import { logger } from '../utils/logger';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Shared persistence tail of both extraction pipelines (screenshot + pasted
 * text): validate/rank emails → persist extraction, primary hrEmail, status,
 * dedupeHash. Duplicate at save time → status 'failed' with a friendly error.
 */
async function persistExtractionResult(
  job: IJobPost,
  result: { extraction: JobExtraction; source: 'vision' | 'ocr'; rawText: string },
): Promise<void> {
  const { extraction, source, rawText } = result;

  // Regex + MX validation, then rank (SPEC §4A).
  const ranked = await validateAndRankEmails(extraction.hrEmails, extraction.hrName);

  job.extraction = { ...extraction, hrEmails: ranked, source };
  job.rawExtractedText = rawText;
  job.hrEmail = ranked[0]?.email ?? null;
  job.needsEmail = ranked.length === 0;
  job.status = extraction.confidence < 0.5 ? 'needs_review' : 'extracted';
  job.error = null;
  job.dedupeHash = job.hrEmail
    ? computeDedupeHash(String(job.userId), job.hrEmail, extraction.company, extraction.role)
    : null;

  try {
    await job.save();
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Same (hrEmail, company, role) already exists for this user — the
      // PUT /extraction route is where duplicates surface interactively;
      // here we just refuse to persist a duplicate.
      job.status = 'failed';
      job.error = 'Duplicate application: same HR email, company and role already exist';
      job.dedupeHash = null;
      await job.save();
      return;
    }
    throw err;
  }
}

/** Shared failure tail: flag the job 'failed' and persist the reason. */
async function persistExtractionFailure(job: IJobPost, err: unknown, jobPostId: string): Promise<void> {
  job.status = 'failed';
  job.error = err instanceof Error ? err.message : 'Extraction failed';
  logger.error({ err, jobPostId }, 'Extraction failed');
  await job.save().catch((saveErr) => {
    logger.error({ err: saveErr, jobPostId }, 'Failed to persist extraction failure state');
  });
}

/**
 * Extraction pipeline for one JobPost (SPEC §4 Step A):
 * read screenshot → AI provider (vision, OCR fallback) → validate/rank
 * emails → persist extraction, primary hrEmail, status, dedupeHash.
 *
 * Transport-agnostic on purpose: routes call it fire-and-forget today, and
 * M3 registers this exact function as an Agenda job without changes.
 */
export async function runExtraction(jobPostId: string): Promise<void> {
  const job = await JobPost.findById(jobPostId);
  if (!job) {
    logger.warn({ jobPostId }, 'runExtraction: JobPost not found');
    return;
  }

  try {
    const buffer = await fs.promises.readFile(job.screenshotPath);
    const mimeType = sniffImageMime(buffer.subarray(0, 12)) ?? 'image/png';

    const provider = getAIProvider();
    const result = await provider.extractJobFromImage(buffer, mimeType);
    await persistExtractionResult(job, result);
  } catch (err) {
    await persistExtractionFailure(job, err, jobPostId);
  }
}

/**
 * Extraction pipeline for a pasted-text JobPost (Phase 2, POST /jobs/import).
 * The pasted text was stored in rawExtractedText at creation; the provider's
 * text path (Gemini text prompt, or regex heuristics without an API key)
 * re-extracts structure from it. Mirrors runExtraction exactly: called
 * fire-and-forget, persists its own errors, same status progression and
 * duplicate handling — so the client's existing GET /jobs/:id polling works.
 */
export async function runTextExtraction(jobPostId: string): Promise<void> {
  const job = await JobPost.findById(jobPostId);
  if (!job) {
    logger.warn({ jobPostId }, 'runTextExtraction: JobPost not found');
    return;
  }

  try {
    const provider = getAIProvider();
    const result = await provider.extractJobFromText(job.rawExtractedText);
    await persistExtractionResult(job, result);
  } catch (err) {
    await persistExtractionFailure(job, err, jobPostId);
  }
}
