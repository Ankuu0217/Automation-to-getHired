import type { JobPostResponse } from '@jobmail/shared';
import { ImagePlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { recentContactMessage } from '@/components/ProofSheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiRequestError, generateJobEmail, getJob, uploadJobScreenshot } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CARD_STATUS_LABEL,
  cardStatus,
  createUploadQueue,
  enqueueUploads,
  GENERATE_SPACING_MS,
  isCardReady,
  MAX_BATCH_FILES,
  needsAttention,
  nextQueueStep,
  PROCESSING_POLL_MS,
  rateLimitUpload,
  settleUpload,
  summarizeCards,
  type BatchCardPhase,
  type BatchCardSnapshot,
  type BatchCardStatus,
  type UploadQueueState,
} from '@/pages/batchUploadUtils';
import { formatBytes, MAX_SCREENSHOT_BYTES } from '@/pages/newApplicationUtils';

/*
 * Phase 8 — bulk screenshot upload. CLIENT-ONLY orchestration of the
 * existing single-job endpoints:
 *
 * - POST /jobs/upload sits behind uploadLimiter (20 requests / HOUR,
 *   server/src/middleware/rateLimit.ts). Uploads launch at most 3 at a
 *   time with ~1s spacing; a 429 pauses the queue 30s, marks the card
 *   'RATE-LIMITED — RETRYING', and re-queues it at the front.
 * - Extraction is polled via GET /jobs/:id at the single flow's 1.5s cadence.
 * - 'GENERATE ALL READY' calls POST /jobs/:id/generate-email sequentially
 *   with a small delay (generateLimiter: 30/hr) and marks cards DRAFTED.
 * - Actual SENDING never happens here: each card links into the single
 *   NewApplication flow (/apps/new?job=<id>) where the existing
 *   approval-before-send confirmation applies. No bulk blind send.
 */

interface BatchCard {
  localId: string;
  fileName: string;
  fileSize: number;
  /** Object URL for the thumbnail — revoked on unmount. */
  previewUrl: string;
  phase: BatchCardPhase;
  jobId: string | null;
  job: JobPostResponse | null;
  error: string | null;
}

let uidCounter = 0;
function nextLocalId(): string {
  uidCounter += 1;
  return `batch-${Date.now()}-${uidCounter}`;
}

function snapshotOf(card: BatchCard): BatchCardSnapshot {
  return {
    phase: card.phase,
    jobStatus: card.job?.status ?? null,
    hrEmail: card.job?.hrEmail ?? null,
  };
}

const STATUS_COLOR: Record<BatchCardStatus, 'ash' | 'fog' | 'pure' | 'cyan' | 'warn' | 'danger'> = {
  queued: 'fog',
  uploading: 'ash',
  rate_limited: 'warn',
  processing: 'ash',
  needs_review: 'warn',
  no_email: 'warn',
  extracted: 'pure',
  drafting: 'ash',
  drafted: 'cyan',
  failed: 'danger',
};

function BatchCardView({ card }: { card: BatchCard }) {
  const status = cardStatus(snapshotOf(card));
  const job = card.job;
  const extraction = job?.extraction ?? null;
  const settled = card.phase === 'settled' || card.phase === 'drafting' || card.phase === 'drafted';
  const showReview = settled && job !== null && (needsAttention(status) || status === 'failed');
  const showReviewAndSend =
    settled && job !== null && (status === 'extracted' || status === 'drafted');

  return (
    <div className="rounded-card border border-graphite bg-ink-2 p-4">
      <div className="flex items-start gap-3">
        <img
          src={card.previewUrl}
          alt={`Preview of ${card.fileName}`}
          className="h-16 w-16 shrink-0 rounded-btn border border-graphite object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-sm font-normal text-paper">{card.fileName}</p>
          <Mono size="xs" color="fog">{formatBytes(card.fileSize)}</Mono>
          <div className="mt-1">
            <Mono size="xs" color={STATUS_COLOR[status]}>
              {CARD_STATUS_LABEL[status]}
            </Mono>
          </div>
        </div>
      </div>

      {settled && extraction && (
        <p className="mt-3 truncate font-sans text-sm font-normal text-paper">
          {extraction.company ?? '—'}
          <span className="text-text-3-dark"> · </span>
          <span className="text-text-2-dark">{extraction.role ?? '—'}</span>
          {job?.match && (
            <>
              <span className="text-text-3-dark"> · </span>
              <span className="font-mono text-[11px] uppercase tracking-[-0.02em] text-text-2-dark">
                Match · {job.match.score}
              </span>
            </>
          )}
        </p>
      )}

      {settled && job?.recentContact && (
        <p className="mt-2 font-sans text-xs font-normal text-warn">
          {recentContactMessage(job.recentContact)}
        </p>
      )}

      {card.error && (
        <p className="mt-2 font-sans text-xs font-normal text-danger">{card.error}</p>
      )}
      {settled && status === 'failed' && !card.error && job?.error && (
        <p className="mt-2 font-sans text-xs font-normal text-danger">{job.error}</p>
      )}

      {(showReview || showReviewAndSend) && (
        <div className="mt-3 flex items-center justify-end border-t border-graphite pt-3">
          {showReviewAndSend ? (
            <Link
              to={`/apps/new?job=${job.id}`}
              className={buttonVariants({ size: 'sm' })}
            >
              Review &amp; send
            </Link>
          ) : (
            <Link
              to={`/apps/new?job=${job.id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Review
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function BatchUpload() {
  const [cards, setCards] = useState<BatchCard[]>([]);
  const [generating, setGenerating] = useState(false);

  const queueRef = useRef<UploadQueueState>(createUploadQueue());
  const filesRef = useRef(new Map<string, File>());
  const urlsRef = useRef<string[]>([]);
  const pumpTimerRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const patchCard = useCallback((localId: string, patch: Partial<BatchCard>) => {
    setCards((prev) => prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
  }, []);

  const patchCardByJobId = useCallback((jobId: string, patch: Partial<BatchCard>) => {
    setCards((prev) => prev.map((c) => (c.jobId === jobId ? { ...c, ...patch } : c)));
  }, []);

  /**
   * Drive the upload queue: launch while a slot is free (max 3 active,
   * ~1s apart), otherwise arm a timer for the next eligible moment.
   * Every settle/429 re-pumps. Pure decisions live in batchUploadUtils.
   */
  const pump = useCallback(() => {
    if (disposedRef.current) return;
    if (pumpTimerRef.current !== null) {
      window.clearTimeout(pumpTimerRef.current);
      pumpTimerRef.current = null;
    }
    const step = nextQueueStep(queueRef.current, Date.now());
    if (step.kind === 'idle') return;
    if (step.kind === 'wait') {
      pumpTimerRef.current = window.setTimeout(pump, step.delayMs);
      return;
    }
    queueRef.current = step.state;
    const { id } = step;
    patchCard(id, { phase: 'uploading', error: null });
    const file = filesRef.current.get(id);
    if (!file) {
      queueRef.current = settleUpload(queueRef.current, id);
      pump();
      return;
    }
    void uploadJobScreenshot(file)
      .then(({ jobPostId }) => {
        queueRef.current = settleUpload(queueRef.current, id);
        patchCard(id, { phase: 'processing', jobId: jobPostId });
      })
      .catch((error) => {
        if (error instanceof ApiRequestError && error.status === 429) {
          /* uploadLimiter (20/hr) pushed back — pause the queue 30s and retry. */
          queueRef.current = rateLimitUpload(queueRef.current, id, Date.now());
          patchCard(id, { phase: 'rate_limited' });
        } else {
          queueRef.current = settleUpload(queueRef.current, id);
          patchCard(id, {
            phase: 'upload_failed',
            error: error instanceof Error ? error.message : 'Upload failed — please try again.',
          });
        }
      })
      .finally(() => {
        if (!disposedRef.current) pump();
      });
    /* Try to fill the remaining slots — typically lands on the 1s spacing wait. */
    pump();
  }, [patchCard]);

  /* Navigating away abandons everything cleanly: timers cleared, previews revoked. */
  useEffect(() => {
    disposedRef.current = false;
    const urls = urlsRef.current;
    return () => {
      disposedRef.current = true;
      if (pumpTimerRef.current !== null) {
        window.clearTimeout(pumpTimerRef.current);
        pumpTimerRef.current = null;
      }
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    };
  }, []);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const reason = rejected[0]?.errors[0];
        /* Mirrors the single-flow validation toasts (NewApplication UploadStep). */
        toast.error(
          reason?.code === 'too-many-files'
            ? `Up to ${MAX_BATCH_FILES} screenshots per drop.`
            : reason?.code === 'file-too-large'
              ? 'Screenshot must be 10 MB or smaller.'
              : 'Unsupported file — use a PNG, JPEG, or WebP screenshot.',
        );
      }
      if (accepted.length === 0) return;
      const newCards = accepted.map((file): BatchCard => {
        const localId = nextLocalId();
        filesRef.current.set(localId, file);
        const previewUrl = URL.createObjectURL(file);
        urlsRef.current.push(previewUrl);
        return {
          localId,
          fileName: file.name,
          fileSize: file.size,
          previewUrl,
          phase: 'queued',
          jobId: null,
          job: null,
          error: null,
        };
      });
      setCards((prev) => [...prev, ...newCards]);
      queueRef.current = enqueueUploads(
        queueRef.current,
        newCards.map((c) => c.localId),
      );
      pump();
    },
    [pump],
  );

  /* Same accepted types + size cap as the single flow. */
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/webp': ['.webp'],
    },
    maxSize: MAX_SCREENSHOT_BYTES,
    multiple: true,
    maxFiles: MAX_BATCH_FILES,
  });

  /*
   * Poll extraction at the single flow's cadence (1.5s) — one interval
   * sweeping every processing card. Keyed on the set of processing job ids
   * so the interval survives unrelated card re-renders.
   */
  const processingKey = cards
    .filter((c) => c.phase === 'processing' && c.jobId !== null)
    .map((c) => c.jobId)
    .join(',');

  useEffect(() => {
    if (!processingKey) return;
    const ids = processingKey.split(',');
    const inFlight = new Set<string>();
    const tick = () => {
      for (const jobId of ids) {
        if (inFlight.has(jobId)) continue;
        inFlight.add(jobId);
        getJob(jobId)
          .then(({ job }) => {
            if (job.status !== 'processing') {
              patchCardByJobId(jobId, { phase: 'settled', job });
            }
          })
          .catch((error) => {
            /* Transient errors keep polling; a hard 404 is terminal. */
            if (error instanceof ApiRequestError && error.status === 404) {
              patchCardByJobId(jobId, {
                phase: 'upload_failed',
                error: 'This job post no longer exists.',
              });
            }
          })
          .finally(() => {
            inFlight.delete(jobId);
          });
      }
    };
    const interval = window.setInterval(tick, PROCESSING_POLL_MS);
    return () => window.clearInterval(interval);
  }, [processingKey, patchCardByJobId]);

  /*
   * Bulk generation ONLY — sequential generate-email calls with a small
   * delay (generateLimiter: 30/hr). Sending stays per-card behind the single
   * flow's explicit approval; there is deliberately no bulk send button.
   */
  const handleGenerateAll = useCallback(async () => {
    const ready = cards.filter((c) => c.jobId !== null && isCardReady(cardStatus(snapshotOf(c))));
    if (ready.length === 0) return;
    setGenerating(true);
    for (const card of ready) {
      if (disposedRef.current) break;
      patchCard(card.localId, { phase: 'drafting', error: null });
      try {
        const data = await generateJobEmail(card.jobId as string);
        patchCard(card.localId, { phase: 'drafted', job: data.job });
      } catch (error) {
        patchCard(card.localId, {
          phase: 'settled',
          error: error instanceof Error ? error.message : 'Could not generate the email.',
        });
        if (error instanceof ApiRequestError && error.status === 429) {
          toast.error('Generation rate limit reached — try the remaining cards in a while.');
          break;
        }
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, GENERATE_SPACING_MS);
      });
    }
    if (!disposedRef.current) setGenerating(false);
  }, [cards, patchCard]);

  const summary = summarizeCards(cards.map(snapshotOf));

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">
            Batch upload
          </Mono>
          <h1 className="mt-1 font-sans text-heading font-normal text-paper">
            Ten screenshots. One pass.
          </h1>
        </div>
        <Link to="/apps/new" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Single upload
        </Link>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          'focus-ring relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-btn border border-dashed border-graphite bg-ink px-6 py-12 text-center transition-quick hover:border-lime',
          isDragActive && 'border-lime',
        )}
      >
        <input {...getInputProps()} aria-label="Job post screenshots" />
        <div
          className={cn(
            'flex size-12 items-center justify-center rounded-btn border border-graphite bg-ink-2 text-text-2-dark transition-quick',
            isDragActive && 'border-text-3-dark text-paper',
          )}
        >
          <ImagePlus className="size-6" />
        </div>
        {isDragActive ? (
          <p className="font-sans text-sm font-normal text-paper">Drop the screenshots here</p>
        ) : (
          <>
            <p className="font-sans text-sm font-normal text-paper">
              Drag &amp; drop up to {MAX_BATCH_FILES} job post screenshots, or{' '}
              <span className="text-paper underline underline-offset-4">browse</span>
            </p>
            <Mono size="xs" color="fog">
              PNG, JPEG, or WebP — up to {formatBytes(MAX_SCREENSHOT_BYTES)} each
            </Mono>
          </>
        )}
      </div>

      {cards.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <BatchCardView key={card.localId} card={card} />
            ))}
          </div>

          {/* Sticky summary bar — counts + bulk GENERATE (never bulk send). */}
          <div className="sticky bottom-4 rounded-card border border-graphite bg-ink-2 p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Mono size="sm" color="pure">
                {summary.uploaded} uploaded · {summary.ready} ready · {summary.attention} need
                attention · {summary.failed} failed
                {summary.drafted > 0 ? ` · ${summary.drafted} drafted` : ''}
              </Mono>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Mono size="xs" color="fog">
                  Sends are approved one by one.
                </Mono>
                <Button
                  onClick={() => void handleGenerateAll()}
                  disabled={generating || summary.ready === 0}
                >
                  {generating ? 'Generating…' : 'Generate all ready'}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
