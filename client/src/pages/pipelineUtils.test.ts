import type { ApplicationDetailResponse } from '@jobmail/shared';
import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  formatDaysSinceSent,
  formatInterviewBadge,
  formatRelativeTime,
  isInterviewSoon,
  stageBadgeVariant,
  stageLabel,
} from '@/pages/pipelineUtils';

function makeApplication(
  overrides: Partial<ApplicationDetailResponse> = {},
): ApplicationDetailResponse {
  return {
    id: 'app-1',
    jobPostId: 'job-1',
    hrEmail: 'priya@acme.com',
    hrName: 'Priya',
    company: 'Acme',
    role: 'Frontend Engineer',
    stage: 'applied',
    notes: '',
    emails: [],
    events: [],
    interviewAt: null,
    interviewNote: null,
    createdAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('stageLabel / stageBadgeVariant', () => {
  it('labels every stage', () => {
    expect(stageLabel('applied')).toBe('Applied');
    expect(stageLabel('hr_screen')).toBe('HR Screen');
    expect(stageLabel('interview')).toBe('Interview');
    expect(stageLabel('offer')).toBe('Offer');
    expect(stageLabel('rejected')).toBe('Rejected');
    expect(stageLabel('ghosted')).toBe('Ghosted');
  });

  it('maps stages to badge variants', () => {
    expect(stageBadgeVariant('offer')).toBe('success');
    expect(stageBadgeVariant('rejected')).toBe('destructive');
    expect(stageBadgeVariant('applied')).toBe('secondary');
  });
});

describe('formatDaysSinceSent', () => {
  it('handles null, today, and N days', () => {
    expect(formatDaysSinceSent(null)).toBeNull();
    expect(formatDaysSinceSent(0)).toBe('Sent today');
    expect(formatDaysSinceSent(1)).toBe('1 day ago');
    expect(formatDaysSinceSent(6)).toBe('6 days ago');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-24T12:00:00.000Z').getTime();

  it('formats recent timestamps', () => {
    expect(formatRelativeTime('2026-07-24T12:00:00.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-07-24T11:55:00.000Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-07-24T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-07-22T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('falls back to a date for old timestamps', () => {
    const result = formatRelativeTime('2026-03-04T12:00:00.000Z', now);
    expect(result).toContain('Mar');
    expect(result).toContain('4');
  });
});

describe('buildTimeline', () => {
  it('merges email timestamps and events chronologically, deduped', () => {
    const application = makeApplication({
      emails: [
        {
          subject: 'Hello',
          bodyText: 'Body',
          bodyHtml: '<p>Body</p>',
          kind: 'initial',
          scheduledAt: null,
          sentAt: '2026-07-20T09:00:00.000Z',
          openedAt: '2026-07-21T10:00:00.000Z',
          repliedAt: null,
          bouncedAt: null,
          cancelledAt: null,
          messageId: 'msg-1',
        },
      ],
      events: [
        // Same minute as openedAt → deduped.
        { kind: 'open', meta: {}, createdAt: '2026-07-21T10:00:12.000Z' },
        { kind: 'reply', meta: {}, createdAt: '2026-07-22T08:30:00.000Z' },
      ],
    });

    const timeline = buildTimeline(application);
    expect(timeline.map((e) => e.kind)).toEqual(['sent', 'opened', 'replied']);
    expect(timeline[0]?.at).toBe('2026-07-20T09:00:00.000Z');
    expect(timeline[2]?.at).toBe('2026-07-22T08:30:00.000Z');
  });

  it('returns an empty timeline when nothing happened yet', () => {
    expect(buildTimeline(makeApplication())).toEqual([]);
  });
});

describe('formatInterviewBadge / isInterviewSoon', () => {
  it('formats a compact mono badge in local time', () => {
    // Built from local-time parts so the expectation is timezone-stable.
    const iso = new Date(2026, 7, 12, 14, 0).toISOString();
    expect(formatInterviewBadge(iso)).toBe('AUG 12 · 14:00');
    const single = new Date(2026, 0, 3, 9, 5).toISOString();
    expect(formatInterviewBadge(single)).toBe('JAN 3 · 09:05');
  });

  it('flags interviews within the next 48 hours only', () => {
    const now = new Date('2026-08-10T12:00:00.000Z').getTime();
    expect(isInterviewSoon('2026-08-11T12:00:00.000Z', now)).toBe(true); // 24h out
    expect(isInterviewSoon('2026-08-12T12:00:00.000Z', now)).toBe(true); // exactly 48h
    expect(isInterviewSoon('2026-08-12T12:00:01.000Z', now)).toBe(false); // past 48h
    expect(isInterviewSoon('2026-08-10T11:59:59.000Z', now)).toBe(false); // already past
  });
});
