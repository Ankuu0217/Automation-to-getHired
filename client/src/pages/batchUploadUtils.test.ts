import { describe, expect, it } from 'vitest';

import {
  cardStatus,
  createUploadQueue,
  enqueueUploads,
  isCardReady,
  needsAttention,
  nextQueueStep,
  rateLimitUpload,
  RATE_LIMIT_PAUSE_MS,
  settleUpload,
  summarizeCards,
  UPLOAD_CONCURRENCY,
  UPLOAD_SPACING_MS,
  type BatchCardSnapshot,
} from '@/pages/batchUploadUtils';

describe('upload queue stepping', () => {
  it('is idle when nothing is pending', () => {
    expect(nextQueueStep(createUploadQueue(), 0)).toEqual({ kind: 'idle' });
  });

  it('launches the first pending file immediately', () => {
    const state = enqueueUploads(createUploadQueue(), ['a', 'b']);
    const step = nextQueueStep(state, 1000);
    expect(step).toMatchObject({ kind: 'launch', id: 'a' });
    if (step.kind === 'launch') {
      expect(step.state.pending).toEqual(['b']);
      expect(step.state.active).toEqual(['a']);
      expect(step.state.lastLaunchAt).toBe(1000);
    }
  });

  it('enforces ~1s spacing between launches', () => {
    const state = enqueueUploads(createUploadQueue(), ['a', 'b']);
    const first = nextQueueStep(state, 1000);
    expect(first.kind).toBe('launch');
    if (first.kind !== 'launch') return;

    // 400ms later: too soon — wait out the remaining 600ms.
    expect(nextQueueStep(first.state, 1400)).toEqual({ kind: 'wait', delayMs: 600 });

    // At exactly +1s the next file launches.
    const second = nextQueueStep(first.state, 2000);
    expect(second).toMatchObject({ kind: 'launch', id: 'b' });
  });

  it('never exceeds concurrency 3', () => {
    let state = enqueueUploads(createUploadQueue(), ['a', 'b', 'c', 'd', 'e']);
    const launched: string[] = [];
    let now = 0;
    // Launch respecting spacing, never settling anything.
    for (let i = 0; i < 10; i += 1) {
      const step = nextQueueStep(state, now);
      if (step.kind === 'launch') {
        launched.push(step.id);
        state = step.state;
      } else if (step.kind === 'wait') {
        now += step.delayMs;
      } else {
        break;
      }
    }
    expect(launched).toEqual(['a', 'b', 'c']);
    expect(state.active).toHaveLength(UPLOAD_CONCURRENCY);
    expect(nextQueueStep(state, now + UPLOAD_SPACING_MS)).toEqual({ kind: 'idle' });
  });

  it('frees a slot on settle so the next file launches', () => {
    let state = enqueueUploads(createUploadQueue(), ['a', 'b', 'c', 'd']);
    let now = 0;
    for (const id of ['a', 'b', 'c']) {
      now += UPLOAD_SPACING_MS;
      const step = nextQueueStep(state, now);
      expect(step).toMatchObject({ kind: 'launch', id });
      if (step.kind === 'launch') state = step.state;
    }
    expect(nextQueueStep(state, now + UPLOAD_SPACING_MS)).toEqual({ kind: 'idle' });

    state = settleUpload(state, 'b');
    expect(state.active).toEqual(['a', 'c']);
    const step = nextQueueStep(state, now + UPLOAD_SPACING_MS);
    expect(step).toMatchObject({ kind: 'launch', id: 'd' });
  });

  it('pauses 30s on a 429 and relaunches the same file afterwards', () => {
    let state = enqueueUploads(createUploadQueue(), ['a', 'b']);
    const first = nextQueueStep(state, 1000);
    expect(first.kind).toBe('launch');
    if (first.kind !== 'launch') return;
    state = first.state;

    // 'a' comes back 429 at t=2000: re-queued at the front, queue paused.
    state = rateLimitUpload(state, 'a', 2000);
    expect(state.active).toEqual([]);
    expect(state.pending).toEqual(['a', 'b']);
    expect(state.pausedUntil).toBe(2000 + RATE_LIMIT_PAUSE_MS);

    // While paused: wait for the remainder of the 30s window.
    expect(nextQueueStep(state, 3000)).toEqual({
      kind: 'wait',
      delayMs: RATE_LIMIT_PAUSE_MS - 1000,
    });

    // Once the pause elapses, the rate-limited file launches first again.
    const resumed = nextQueueStep(state, 2000 + RATE_LIMIT_PAUSE_MS);
    expect(resumed).toMatchObject({ kind: 'launch', id: 'a' });
    if (resumed.kind === 'launch') {
      expect(resumed.state.pausedUntil).toBeNull();
      expect(resumed.state.pending).toEqual(['b']);
    }
  });
});

/* ── Status derivation from the job DTO ─────────────────────────── */

function snapshot(overrides: Partial<BatchCardSnapshot> = {}): BatchCardSnapshot {
  return { phase: 'settled', jobStatus: 'extracted', hrEmail: 'hr@acme.com', ...overrides };
}

describe('cardStatus', () => {
  it('reflects the client phase before the job settles', () => {
    expect(cardStatus(snapshot({ phase: 'queued', jobStatus: null, hrEmail: null }))).toBe('queued');
    expect(cardStatus(snapshot({ phase: 'uploading', jobStatus: null, hrEmail: null }))).toBe('uploading');
    expect(cardStatus(snapshot({ phase: 'rate_limited', jobStatus: null, hrEmail: null }))).toBe('rate_limited');
    expect(cardStatus(snapshot({ phase: 'upload_failed', jobStatus: null, hrEmail: null }))).toBe('failed');
    expect(cardStatus(snapshot({ phase: 'processing', jobStatus: null, hrEmail: null }))).toBe('processing');
    expect(cardStatus(snapshot({ phase: 'drafting' }))).toBe('drafting');
    expect(cardStatus(snapshot({ phase: 'drafted' }))).toBe('drafted');
  });

  it('maps settled job DTO statuses', () => {
    expect(cardStatus(snapshot({ jobStatus: 'extracted' }))).toBe('extracted');
    expect(cardStatus(snapshot({ jobStatus: 'needs_review' }))).toBe('needs_review');
    expect(cardStatus(snapshot({ jobStatus: 'failed' }))).toBe('failed');
    expect(cardStatus(snapshot({ jobStatus: 'email_drafted' }))).toBe('drafted');
    expect(cardStatus(snapshot({ jobStatus: 'awaiting_review' }))).toBe('drafted');
    expect(cardStatus(snapshot({ jobStatus: 'queued' }))).toBe('drafted');
    expect(cardStatus(snapshot({ jobStatus: 'sent' }))).toBe('drafted');
    expect(cardStatus(snapshot({ jobStatus: 'processing' }))).toBe('processing');
  });

  it('flags an extracted job without a recipient as no_email', () => {
    expect(cardStatus(snapshot({ jobStatus: 'extracted', hrEmail: null }))).toBe('no_email');
  });

  it('classifies ready vs attention', () => {
    expect(isCardReady('extracted')).toBe(true);
    expect(isCardReady('needs_review')).toBe(false);
    expect(isCardReady('drafted')).toBe(false);
    expect(needsAttention('needs_review')).toBe(true);
    expect(needsAttention('no_email')).toBe(true);
    expect(needsAttention('extracted')).toBe(false);
    expect(needsAttention('failed')).toBe(false);
  });
});

describe('summarizeCards', () => {
  it('counts uploaded / ready / attention / failed / drafted', () => {
    const cards: BatchCardSnapshot[] = [
      snapshot({ phase: 'queued', jobStatus: null, hrEmail: null }),
      snapshot({ phase: 'uploading', jobStatus: null, hrEmail: null }),
      snapshot({ phase: 'rate_limited', jobStatus: null, hrEmail: null }),
      snapshot({ phase: 'processing', jobStatus: null, hrEmail: null }),
      snapshot({ jobStatus: 'extracted' }),
      snapshot({ jobStatus: 'extracted', hrEmail: null }),
      snapshot({ jobStatus: 'needs_review' }),
      snapshot({ jobStatus: 'failed' }),
      snapshot({ phase: 'upload_failed', jobStatus: null, hrEmail: null }),
      snapshot({ phase: 'drafted' }),
    ];
    expect(summarizeCards(cards)).toEqual({
      uploaded: 6,
      ready: 1,
      attention: 2,
      failed: 2,
      drafted: 1,
    });
  });

  it('is all zeroes for an empty batch', () => {
    expect(summarizeCards([])).toEqual({ uploaded: 0, ready: 0, attention: 0, failed: 0, drafted: 0 });
  });
});
