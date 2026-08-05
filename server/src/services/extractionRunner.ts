import fs from 'node:fs';
import { JobPost } from '../models/JobPost';
import { getAIProvider } from './ai/provider';
import { validateAndRankEmails } from '../utils/emailValidation';
import { computeDedupeHash } from '../utils/dedupe';
import { sniffImageMime } from '../utils/imageMime';
import { logger } from '../utils/logger';

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
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
    const { extraction, source, rawText } = await provider.extractJobFromImage(buffer, mimeType);

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
  } catch (err) {
    job.status = 'failed';
    job.error = err instanceof Error ? err.message : 'Extraction failed';
    logger.error({ err, jobPostId }, 'Extraction failed');
    await job.save().catch((saveErr) => {
      logger.error({ err: saveErr, jobPostId }, 'Failed to persist extraction failure state');
    });
  }
}
