import type {
  ApplicationDetailResponse,
  ApplicationLastEmail,
  ApplicationSummary,
} from '@jobmail/shared';
import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  columnMeta,
  DEFAULT_PIPELINE_VIEW,
  deserializePipelineView,
  filterApplications,
  formatDaysSinceSent,
  formatInterviewBadge,
  formatRelativeTime,
  isGhosted,
  isInterviewSoon,
  serializePipelineView,
  sortApplications,
  stageBadgeVariant,
  stageLabel,
  type PipelineView,
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

/* ── Board view: filters, sort, persistence ─────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-01T12:00:00.000Z').getTime();

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function makeEmail(overrides: Partial<ApplicationLastEmail> = {}): ApplicationLastEmail {
  return { kind: 'initial', sentAt: null, openedAt: null, repliedAt: null, bouncedAt: null, ...overrides };
}

function makeSummary(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: 'app-1',
    company: 'Acme',
    role: 'Frontend Engineer',
    hrName: 'Priya',
    hrEmail: 'priya@acme.com',
    stage: 'applied',
    daysSinceSent: null,
    lastEmail: null,
    nextFollowUpAt: null,
    interviewAt: null,
    interviewNote: null,
    createdAt: daysAgo(1),
    ...overrides,
  };
}

const BASE_FILTER = { query: '', range: 'all', hasReply: false, showGhosted: true, now: NOW } as const;

function ids(applications: ApplicationSummary[]): string[] {
  return applications.map((a) => a.id);
}

describe('filterApplications — search', () => {
  const apps = [
    makeSummary({ id: 'a', company: 'Acme Corp', role: 'Backend Engineer' }),
    makeSummary({ id: 'b', company: 'Globex', role: 'Frontend Engineer' }),
    makeSummary({ id: 'c', company: null, role: null }),
  ];

  it('matches company or role, case-insensitive substring', () => {
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: 'acme' }))).toEqual(['a']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: 'ENGINEER' }))).toEqual(['a', 'b']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: 'front' }))).toEqual(['b']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: 'zzz' }))).toEqual([]);
  });

  it('keeps everything on a blank or whitespace query and trims the needle', () => {
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: '' }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: '   ' }))).toEqual(['a', 'b', 'c']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, query: '  globex  ' }))).toEqual(['b']);
  });
});

describe('filterApplications — date range', () => {
  it('ranges by sentAt falling back to createdAt, boundary inclusive', () => {
    const apps = [
      // Created 40 days ago but dispatched 2 days ago → the send date wins.
      makeSummary({
        id: 'sent-recent',
        createdAt: daysAgo(40),
        lastEmail: makeEmail({ sentAt: daysAgo(2) }),
      }),
      // Exactly on the 7-day boundary → still inside.
      makeSummary({ id: 'boundary', createdAt: daysAgo(7) }),
      // One millisecond past 7 days → outside 7D, inside 30D.
      makeSummary({ id: 'just-out', createdAt: new Date(NOW - 7 * DAY - 1).toISOString() }),
      // Way out → only ALL keeps it.
      makeSummary({ id: 'ancient', createdAt: daysAgo(90) }),
    ];

    expect(ids(filterApplications(apps, { ...BASE_FILTER, range: '7d' }))).toEqual([
      'sent-recent',
      'boundary',
    ]);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, range: '30d' }))).toEqual([
      'sent-recent',
      'boundary',
      'just-out',
    ]);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, range: 'all' }))).toEqual([
      'sent-recent',
      'boundary',
      'just-out',
      'ancient',
    ]);
  });
});

describe('filterApplications — has reply', () => {
  it('keeps only applications whose latest email was replied to', () => {
    const apps = [
      makeSummary({
        id: 'replied',
        lastEmail: makeEmail({ sentAt: daysAgo(3), repliedAt: daysAgo(1) }),
      }),
      makeSummary({ id: 'sent-only', lastEmail: makeEmail({ sentAt: daysAgo(3) }) }),
      makeSummary({ id: 'never-sent' }),
    ];

    expect(ids(filterApplications(apps, { ...BASE_FILTER, hasReply: true }))).toEqual(['replied']);
    expect(ids(filterApplications(apps, { ...BASE_FILTER, hasReply: false }))).toEqual([
      'replied',
      'sent-only',
      'never-sent',
    ]);
  });
});

describe('filterApplications — ghosted visibility', () => {
  const apps = [
    makeSummary({ id: 'stage-ghosted', stage: 'ghosted' }),
    // Implicitly ghosted: 14+ days since send, no reply (dashed-card rule).
    makeSummary({
      id: 'implicit',
      daysSinceSent: 14,
      lastEmail: makeEmail({ sentAt: daysAgo(14) }),
    }),
    // Stale but replied → NOT ghosted.
    makeSummary({
      id: 'stale-replied',
      daysSinceSent: 20,
      lastEmail: makeEmail({ sentAt: daysAgo(20), repliedAt: daysAgo(18) }),
    }),
    makeSummary({ id: 'fresh', daysSinceSent: 2, lastEmail: makeEmail({ sentAt: daysAgo(2) }) }),
  ];

  it('shows ghosted cards by default (current board behavior)', () => {
    expect(DEFAULT_PIPELINE_VIEW.showGhosted).toBe(true);
    expect(ids(filterApplications(apps, BASE_FILTER))).toEqual([
      'stage-ghosted',
      'implicit',
      'stale-replied',
      'fresh',
    ]);
  });

  it('hides explicit and implicit ghosted cards when toggled off', () => {
    expect(ids(filterApplications(apps, { ...BASE_FILTER, showGhosted: false }))).toEqual([
      'stale-replied',
      'fresh',
    ]);
  });

  it('isGhosted matches the dashed-card rule', () => {
    expect(isGhosted(makeSummary({ stage: 'ghosted' }))).toBe(true);
    expect(isGhosted(makeSummary({ daysSinceSent: 14, lastEmail: makeEmail() }))).toBe(true);
    expect(isGhosted(makeSummary({ daysSinceSent: 13, lastEmail: makeEmail() }))).toBe(false);
    expect(
      isGhosted(makeSummary({ daysSinceSent: 20, lastEmail: makeEmail({ repliedAt: daysAgo(1) }) })),
    ).toBe(false);
    expect(isGhosted(makeSummary({ daysSinceSent: null }))).toBe(false);
  });
});

describe('sortApplications', () => {
  const apps = [
    makeSummary({ id: 'mid', createdAt: daysAgo(10) }),
    makeSummary({ id: 'new', createdAt: daysAgo(1) }),
    makeSummary({ id: 'old', createdAt: daysAgo(30) }),
  ];

  it('sorts newest first by createdAt (the API default order)', () => {
    expect(ids(sortApplications(apps, 'newest'))).toEqual(['new', 'mid', 'old']);
  });

  it('sorts oldest first by createdAt', () => {
    expect(ids(sortApplications(apps, 'oldest'))).toEqual(['old', 'mid', 'new']);
  });

  it('sorts most-stale by last activity ascending (max of sent/opened/replied/created)', () => {
    const staleApps = [
      // Created long ago but opened yesterday → most recent activity.
      makeSummary({
        id: 'active',
        createdAt: daysAgo(30),
        lastEmail: makeEmail({ sentAt: daysAgo(8), openedAt: daysAgo(1) }),
      }),
      // Never emailed → activity is creation, 10 days ago → most stale.
      makeSummary({ id: 'dormant', createdAt: daysAgo(10) }),
      // Sent 5 days ago → in between.
      makeSummary({
        id: 'waiting',
        createdAt: daysAgo(20),
        lastEmail: makeEmail({ sentAt: daysAgo(5) }),
      }),
    ];
    expect(ids(sortApplications(staleApps, 'stale'))).toEqual(['dormant', 'waiting', 'active']);
  });

  it('returns a new array and leaves the input untouched', () => {
    const before = ids(apps);
    const sorted = sortApplications(apps, 'oldest');
    expect(sorted).not.toBe(apps);
    expect(ids(apps)).toEqual(before);
  });
});

describe('columnMeta', () => {
  it('counts stage cards and reports whole days since the oldest createdAt', () => {
    const apps = [
      makeSummary({ id: 'a', stage: 'applied', createdAt: new Date(NOW - 12 * DAY - 5 * 60 * 60 * 1000).toISOString() }),
      makeSummary({ id: 'b', stage: 'applied', createdAt: daysAgo(3) }),
      makeSummary({ id: 'c', stage: 'interview', createdAt: daysAgo(40) }),
    ];
    expect(columnMeta(apps, 'applied', NOW)).toEqual({ count: 2, oldestDays: 12 });
    expect(columnMeta(apps, 'interview', NOW)).toEqual({ count: 1, oldestDays: 40 });
  });

  it('returns count 0 and null age for an empty column', () => {
    expect(columnMeta([], 'offer', NOW)).toEqual({ count: 0, oldestDays: null });
    expect(columnMeta([makeSummary({ stage: 'applied' })], 'offer', NOW)).toEqual({
      count: 0,
      oldestDays: null,
    });
  });

  it('clamps future createdAt to 0 days', () => {
    const apps = [makeSummary({ stage: 'offer', createdAt: new Date(NOW + DAY).toISOString() })];
    expect(columnMeta(apps, 'offer', NOW)).toEqual({ count: 1, oldestDays: 0 });
  });
});

describe('pipeline view (de)serialization', () => {
  it('round-trips a non-default view', () => {
    const view: PipelineView = { range: '7d', hasReply: true, showGhosted: false, sort: 'stale' };
    expect(deserializePipelineView(serializePipelineView(view))).toEqual(view);
  });

  it('falls back to defaults on corrupt or missing localStorage JSON', () => {
    expect(deserializePipelineView('{not json at all')).toEqual(DEFAULT_PIPELINE_VIEW);
    expect(deserializePipelineView(null)).toEqual(DEFAULT_PIPELINE_VIEW);
    expect(deserializePipelineView(undefined)).toEqual(DEFAULT_PIPELINE_VIEW);
    expect(deserializePipelineView('')).toEqual(DEFAULT_PIPELINE_VIEW);
    expect(deserializePipelineView('"just a string"')).toEqual(DEFAULT_PIPELINE_VIEW);
    expect(deserializePipelineView('42')).toEqual(DEFAULT_PIPELINE_VIEW);
  });

  it('discards invalid fields individually, keeping the valid ones', () => {
    const raw = JSON.stringify({ range: 'yesteryear', hasReply: 'yes', showGhosted: false, sort: 'stale' });
    expect(deserializePipelineView(raw)).toEqual({
      range: 'all',
      hasReply: false,
      showGhosted: false,
      sort: 'stale',
    });
  });

  it('defaults match the pre-toolbar board behavior', () => {
    expect(DEFAULT_PIPELINE_VIEW).toEqual({
      range: 'all',
      hasReply: false,
      showGhosted: true,
      sort: 'newest',
    });
  });
});
