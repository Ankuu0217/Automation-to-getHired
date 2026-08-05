import type {
  ApplicationDetailResponse,
  ApplicationEmailKind,
  ApplicationStage,
} from '@jobmail/shared';

/* ── Stage metadata ─────────────────────────────────────────────── */

export interface StageMeta {
  id: ApplicationStage;
  label: string;
}

/** Kanban column order — ghosted is appended only when cards exist. */
export const PIPELINE_STAGES: StageMeta[] = [
  { id: 'applied', label: 'Applied' },
  { id: 'hr_screen', label: 'HR Screen' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
];

export const GHOSTED_STAGE: StageMeta = { id: 'ghosted', label: 'Ghosted' };

/** Every selectable stage (drawer stage picker). */
export const ALL_STAGES: StageMeta[] = [...PIPELINE_STAGES, GHOSTED_STAGE];

export function stageLabel(stage: ApplicationStage): string {
  return ALL_STAGES.find((s) => s.id === stage)?.label ?? stage;
}

type StageBadgeVariant = 'secondary' | 'default' | 'success' | 'destructive' | 'outline';

export function stageBadgeVariant(stage: ApplicationStage): StageBadgeVariant {
  switch (stage) {
    case 'applied':
      return 'secondary';
    case 'hr_screen':
    case 'interview':
      return 'default';
    case 'offer':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'ghosted':
      return 'outline';
  }
}

/* ── Email kind labels ──────────────────────────────────────────── */

export function emailKindLabel(kind: ApplicationEmailKind): string {
  switch (kind) {
    case 'initial':
      return 'Initial';
    case 'followup_1':
      return 'Follow-up 1';
    case 'followup_2':
      return 'Follow-up 2';
  }
}

/* ── Time formatting ────────────────────────────────────────────── */

/** "just now" / "5m ago" / "3h ago" / "2d ago" / "Mar 4" for older dates. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Days-since-sent badge copy for Kanban cards. */
export function formatDaysSinceSent(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return 'Sent today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

/** "Follow-up in 2d" / "Tomorrow" / "Today" countdown for Kanban cards. */
export function formatFollowUpAt(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const ms = then - now;
  if (ms <= 0) return 'Follow-up due';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 2) return `Follow-up in ${days}d`;
  if (days === 1) return 'Follow-up tomorrow';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 2) return `Follow-up in ${hours}h`;
  return 'Follow-up soon';
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* ── Events timeline ────────────────────────────────────────────── */

export type TimelineKind = 'sent' | 'opened' | 'replied' | 'bounced';

export interface TimelineEntry {
  kind: TimelineKind;
  label: string;
  at: string;
}

const EVENT_LABEL: Record<'open' | 'bounce' | 'reply', { kind: TimelineKind; label: string }> = {
  open: { kind: 'opened', label: 'Email opened' },
  reply: { kind: 'replied', label: 'Reply received' },
  bounce: { kind: 'bounced', label: 'Email bounced' },
};

/**
 * Merge per-email timestamps and tracking events into one chronological
 * (oldest-first) timeline. Entries are deduped by kind + minute so an event
 * and the matching email timestamp don't render twice.
 */
export function buildTimeline(application: ApplicationDetailResponse): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const seen = new Set<string>();

  const push = (kind: TimelineKind, label: string, at: string) => {
    const key = `${kind}:${at.slice(0, 16)}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ kind, label, at });
  };

  for (const email of application.emails) {
    const base = emailKindLabel(email.kind);
    if (email.sentAt) push('sent', `${base} email sent`, email.sentAt);
    if (email.openedAt) push('opened', `${base} email opened`, email.openedAt);
    if (email.repliedAt) push('replied', 'Reply received', email.repliedAt);
    if (email.bouncedAt) push('bounced', `${base} email bounced`, email.bouncedAt);
  }

  for (const event of application.events) {
    const meta = EVENT_LABEL[event.kind];
    if (meta) push(meta.kind, meta.label, event.createdAt);
  }

  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
