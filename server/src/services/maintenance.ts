import { JobPost } from '../models/JobPost';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  extractionsInFlight,
  persistExtractionFailure,
  runExtraction,
  runTextExtraction,
} from './extractionRunner';
import { removeFile } from './storage';

/**
 * Background maintenance, safe to run on every instance at once (each job is
 * claimed with an atomic findOneAndUpdate):
 *
 *  1. Stale-extraction recovery — extraction is fire-and-forget from the
 *     upload request, so a deploy/crash mid-extraction used to leave the
 *     JobPost in 'processing' forever (spinner never ends). Jobs stuck longer
 *     than STALE_AFTER_MS are re-run from storage, up to MAX_ATTEMPTS, then
 *     degraded to the manual-review form.
 *  2. Screenshot retention — deletes stored screenshots older than
 *     SCREENSHOT_RETENTION_DAYS (the extracted fields/JD text stay), which
 *     keeps ImageKit/disk usage flat instead of growing forever.
 */

export const STALE_AFTER_MS = 15 * 60 * 1000;
export const MAX_EXTRACTION_ATTEMPTS = 3;
const BATCH = 50;
const INTERVAL_MS = 5 * 60 * 1000;

export async function recoverStaleExtractions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  let recovered = 0;
  for (let i = 0; i < BATCH; i++) {
    const local = extractionsInFlight();
    // Atomic claim: bumping updatedAt (timestamps) hides it from other sweepers.
    const job = await JobPost.findOneAndUpdate(
      { status: 'processing', updatedAt: { $lt: cutoff }, _id: { $nin: local } },
      { $inc: { extractionAttempts: 1 } },
      { new: true, sort: { updatedAt: 1 } },
    );
    if (!job) break;
    recovered += 1;
    const id = String(job._id);
    if (job.extractionAttempts > MAX_EXTRACTION_ATTEMPTS) {
      await persistExtractionFailure(job, new Error('Extraction abandoned after repeated restarts'), id);
      continue;
    }
    logger.warn({ jobPostId: id, attempt: job.extractionAttempts }, 'Re-running stale extraction');
    // Not awaited: runs through the shared extraction semaphore.
    void (job.screenshotPath ? runExtraction(id) : runTextExtraction(id));
  }
  return recovered;
}

export async function purgeExpiredScreenshots(now: Date = new Date()): Promise<number> {
  const days = env.SCREENSHOT_RETENTION_DAYS;
  if (!days) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const jobs = await JobPost.find({
    createdAt: { $lt: cutoff },
    screenshotPath: { $gt: '' },
    status: { $ne: 'processing' },
  })
    .select('_id screenshotPath')
    .limit(200)
    .lean();
  for (const job of jobs) {
    // Clear the reference first (conditional on it being unchanged), then delete the file.
    const res = await JobPost.updateOne(
      { _id: job._id, screenshotPath: job.screenshotPath },
      { $set: { screenshotPath: '' } },
    );
    if (res.modifiedCount === 1) await removeFile(job.screenshotPath);
  }
  if (jobs.length) logger.info({ count: jobs.length, days }, 'Purged expired job screenshots');
  return jobs.length;
}

let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  try {
    await recoverStaleExtractions();
    await purgeExpiredScreenshots();
  } catch (err) {
    logger.error({ err }, 'Maintenance tick failed');
  }
}

/** Start the periodic sweeps (first run immediately). Call after mongoose.connect. */
export function startMaintenance(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();
}

export function stopMaintenance(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
