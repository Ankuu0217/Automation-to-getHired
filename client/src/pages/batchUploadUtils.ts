import type { JobStatus } from '@jobmail/shared';

/**
 * Pure helpers for the batch screenshot upload page (Phase 8). Framework-free
 * so the queue stepping, status derivation, and summary counts are
 * unit-testable without rendering or network.
 *
 * Server rate limits this queue respects (server/src/middleware/rateLimit.ts):
 * - uploadLimiter: 20 requests / hour on POST /jobs/upload.
 * - generateLimiter: 30 requests / hour on POST /jobs/:id/generate-email.
 * A batch is at most 10 files per drop, launched at most 3 at a time with
 * ~1s spacing between launches; a 429 pauses the queue for 30s and re-queues
 * the rate-limited file at the front.
 */

export const MAX_BATCH_FILES = 10;
export const UPLOAD_CONCURRENCY = 3;
export const UPLOAD_SPACING_MS = 1000;
export const RATE_LIMIT_PAUSE_MS = 30_000;
/** Same polling cadence as the single flow (NewApplication refetchInterval). */
export const PROCESSING_POLL_MS = 1500;
/** Spacing between sequential generate-email calls (generateLimiter: 30/hr). */
export const GENERATE_SPACING_MS = 750;

/* ── Upload queue (concurrency 3, 1s spacing, 30s pause on 429) ──── */

export interface UploadQueueState {
  /** Card ids waiting to launch — front of the array launches next. */
  pending: string[];
  /** Card ids with an upload request currently in flight. */
  active: string[];
  /** Epoch ms of the most recent launch — anchors the ~1s spacing. */
  lastLaunchAt: number | null;
  /** Set after a 429 — no launches until this epoch ms. */
  pausedUntil: number | null;
}

export function createUploadQueue(): UploadQueueState {
  return { pending: [], active: [], lastLaunchAt: null, pausedUntil: null };
}

export function enqueueUploads(state: UploadQueueState, ids: string[]): UploadQueueState {
  return { ...state, pending: [...state.pending, ...ids] };
}

export type QueueStep =
  /** Launch this id now; `state` is the queue after the launch. */
  | { kind: 'launch'; id: string; state: UploadQueueState }
  /** Nothing can launch yet — re-step after `delayMs`. */
  | { kind: 'wait'; delayMs: number }
  /** Nothing pending, or all slots busy — re-step on the next settle. */
  | { kind: 'idle' };

/**
 * Decide the next queue action at time `now`. Pure: callers apply the
 * returned state themselves. Launch conditions, in order: something pending,
 * not inside a 429 pause, a free slot (max 3 active), and at least ~1s since
 * the previous launch.
 */
export function nextQueueStep(state: UploadQueueState, now: number): QueueStep {
  if (state.pending.length === 0) return { kind: 'idle' };
  if (state.pausedUntil !== null && now < state.pausedUntil) {
    return { kind: 'wait', delayMs: state.pausedUntil - now };
  }
  if (state.active.length >= UPLOAD_CONCURRENCY) return { kind: 'idle' };
  if (state.lastLaunchAt !== null && now - state.lastLaunchAt < UPLOAD_SPACING_MS) {
    return { kind: 'wait', delayMs: UPLOAD_SPACING_MS - (now - state.lastLaunchAt) };
  }
  const [id, ...rest] = state.pending;
  return {
    kind: 'launch',
    id,
    state: {
      pending: rest,
      active: [...state.active, id],
      lastLaunchAt: now,
      pausedUntil: null,
    },
  };
}

/** Upload finished (success or terminal failure) — frees the slot. */
export function settleUpload(state: UploadQueueState, id: string): UploadQueueState {
  return { ...state, active: state.active.filter((a) => a !== id) };
}

/**
 * Upload hit the uploadLimiter (429): free the slot, put the file back at the
 * FRONT of the queue, and pause all launches for 30s.
 */
export function rateLimitUpload(state: UploadQueueState, id: string, now: number): UploadQueueState {
  return {
    pending: [id, ...state.pending.filter((p) => p !== id)],
    active: state.active.filter((a) => a !== id),
    lastLaunchAt: state.lastLaunchAt,
    pausedUntil: now + RATE_LIMIT_PAUSE_MS,
  };
}

/* ── Card status derivation ─────────────────────────────────────── */

/** Client-side lifecycle of one card, before/around the server job status. */
export type BatchCardPhase =
  | 'queued'
  | 'uploading'
  | 'rate_limited'
  | 'upload_failed'
  | 'processing'
  | 'settled'
  | 'drafting'
  | 'drafted';

export type BatchCardStatus =
  | 'queued'
  | 'uploading'
  | 'rate_limited'
  | 'processing'
  | 'needs_review'
  | 'no_email'
  | 'extracted'
  | 'drafting'
  | 'drafted'
  | 'failed';

export interface BatchCardSnapshot {
  phase: BatchCardPhase;
  /** Job DTO status once the card settled (null before then). */
  jobStatus: JobStatus | null;
  /** Primary HR email from the job DTO (null before settle / when missing). */
  hrEmail: string | null;
}

/** Display status of a card, merging the client phase with the job DTO. */
export function cardStatus(card: BatchCardSnapshot): BatchCardStatus {
  switch (card.phase) {
    case 'queued':
      return 'queued';
    case 'uploading':
      return 'uploading';
    case 'rate_limited':
      return 'rate_limited';
    case 'upload_failed':
      return 'failed';
    case 'processing':
      return 'processing';
    case 'drafting':
      return 'drafting';
    case 'drafted':
      return 'drafted';
    case 'settled':
      break;
  }
  switch (card.jobStatus) {
    case 'failed':
      return 'failed';
    case 'needs_review':
      return 'needs_review';
    case 'extracted':
      return card.hrEmail ? 'extracted' : 'no_email';
    case 'email_drafted':
    case 'awaiting_review':
    case 'queued':
    case 'sent':
      return 'drafted';
    case 'processing':
    case null:
      return 'processing';
  }
}

export const CARD_STATUS_LABEL: Record<BatchCardStatus, string> = {
  queued: 'QUEUED',
  uploading: 'UPLOADING',
  rate_limited: 'RATE-LIMITED — RETRYING',
  processing: 'PROCESSING',
  needs_review: 'NEEDS REVIEW',
  no_email: 'NO EMAIL FOUND',
  extracted: 'EXTRACTED',
  drafting: 'DRAFTING',
  drafted: 'DRAFTED',
  failed: 'FAILED',
};

/** Ready = extraction complete with a recipient — a generate-email candidate. */
export function isCardReady(status: BatchCardStatus): boolean {
  return status === 'extracted';
}

/** Needs a human in the single-flow review step before it can proceed. */
export function needsAttention(status: BatchCardStatus): boolean {
  return status === 'needs_review' || status === 'no_email';
}

/* ── Summary bar counts ─────────────────────────────────────────── */

export interface BatchSummary {
  /** Cards accepted by the server (202) — includes processing and settled. */
  uploaded: number;
  ready: number;
  attention: number;
  failed: number;
  drafted: number;
}

export function summarizeCards(cards: BatchCardSnapshot[]): BatchSummary {
  const summary: BatchSummary = { uploaded: 0, ready: 0, attention: 0, failed: 0, drafted: 0 };
  for (const card of cards) {
    const status = cardStatus(card);
    if (
      card.phase !== 'queued' &&
      card.phase !== 'uploading' &&
      card.phase !== 'rate_limited' &&
      card.phase !== 'upload_failed'
    ) {
      summary.uploaded += 1;
    }
    if (isCardReady(status)) summary.ready += 1;
    else if (needsAttention(status)) summary.attention += 1;
    else if (status === 'failed') summary.failed += 1;
    else if (status === 'drafted') summary.drafted += 1;
  }
  return summary;
}
