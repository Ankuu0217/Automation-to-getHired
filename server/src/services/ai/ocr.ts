import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../../utils/logger';

/**
 * OCR fallback (SPEC §2): plain tesseract.js text recognition. Only used
 * when no vision API key is configured or the vision call fails.
 *
 * One worker is reused across calls (spinning one up loads the ~5 MB
 * language model and costs 1–3 s per screenshot) and shut down after a few
 * idle minutes so it doesn't hold memory on small instances.
 *
 * `errorHandler` is REQUIRED: without it tesseract.js rethrows a worker-side
 * failure (e.g. a corrupt PNG that passed the magic-byte sniff) as an
 * uncaught exception, which crashes the whole API process. The failure is
 * still delivered to the caller as a rejected recognize() promise.
 */

const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;

let workerPromise: Promise<Worker> | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      errorHandler: (err: unknown) => logger.debug({ err }, 'tesseract worker job failed'),
    }).catch((err: unknown) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void terminateOcr(), IDLE_SHUTDOWN_MS);
  idleTimer.unref();
}

export async function ocrImage(buffer: Buffer): Promise<string> {
  const worker = await getWorker();
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    scheduleIdleShutdown();
  }
}

/** Stop the shared worker (idle timeout, graceful shutdown). */
export async function terminateOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const pending = workerPromise;
  workerPromise = null;
  if (pending) {
    await pending.then((w) => w.terminate()).catch(() => undefined);
  }
}
