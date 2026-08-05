import type { HrEmail, JobPostResponse, JobStatus } from '@jobmail/shared';

/**
 * Pure helpers for the New Application flow (M2). Kept framework-free so the
 * tricky decision logic (edge cases 1–4, 8 in SPEC §9) is unit-testable
 * without rendering or network.
 */

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/* ── Confidence (edge cases 2 + 3) ──────────────────────────────── */

export type ConfidenceTier = 'high' | 'medium' | 'low';

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/** Badge variant per tier: green ≥0.8, amber 0.5–0.8, red <0.5. */
export function confidenceBadgeVariant(confidence: number): 'success' | 'warning' | 'destructive' {
  const tier = confidenceTier(confidence);
  return tier === 'high' ? 'success' : tier === 'medium' ? 'warning' : 'destructive';
}

/** Low-confidence review banner shows on `needs_review` status or confidence < 0.5. */
export function needsLowConfidenceWarning(job: JobPostResponse): boolean {
  if (job.status === 'needs_review') return true;
  const confidence = job.extraction?.confidence;
  return confidence != null && confidence < 0.5;
}

/* ── HR email ranking & default selection (edge cases 1 + 2) ────── */

/** Ranked by confidence, highest first. Never mutates the input. */
export function rankHrEmails(hrEmails: HrEmail[]): HrEmail[] {
  return [...hrEmails].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Default selected HR email: highest-confidence candidate, or null when the
 * screenshot had no email at all (manual entry state).
 */
export function defaultHrEmail(hrEmails: HrEmail[], hrEmail: string | null): string | null {
  if (hrEmail) return hrEmail;
  return rankHrEmails(hrEmails)[0]?.email ?? null;
}

/* ── Step derivation ────────────────────────────────────────────── */

export type FlowStep = 1 | 2 | 3;

/**
 * Which step a job lands on: still working (or failed) → upload step, anything
 * with a reviewable extraction → review step.
 */
export function stepForStatus(status: JobStatus): FlowStep {
  return status === 'processing' || status === 'failed' ? 1 : 2;
}

/** Polling continues only while the server is still analyzing. */
export function isJobProcessing(status: JobStatus | undefined): boolean {
  return status === 'processing';
}

/* ── Status presentation (dashboard list + review header) ───────── */

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'processing':
      return 'Processing…';
    case 'extracted':
      return 'Extracted';
    case 'needs_review':
      return 'Needs review';
    case 'failed':
      return 'Extraction failed';
    case 'email_drafted':
      return 'Email drafted';
    case 'awaiting_review':
      return 'Awaiting review';
    case 'queued':
      return 'Queued';
    case 'sent':
      return 'Sent';
  }
}

export function jobStatusBadgeVariant(
  status: JobStatus,
): 'default' | 'secondary' | 'success' | 'warning' | 'destructive' {
  switch (status) {
    case 'processing':
      return 'secondary';
    case 'extracted':
    case 'email_drafted':
    case 'awaiting_review':
      return 'default';
    case 'needs_review':
    case 'queued':
      return 'warning';
    case 'failed':
      return 'destructive';
    case 'sent':
      return 'success';
  }
}

/* ── Small formatters ───────────────────────────────────────────── */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAcceptedImage(file: { type: string; size: number }): boolean {
  return (
    (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type) &&
    file.size <= MAX_SCREENSHOT_BYTES
  );
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / locale date beyond a week. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
