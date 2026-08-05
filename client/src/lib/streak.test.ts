import { describe, expect, it } from 'vitest';

import { computeStreak, startOfWeek } from '@/lib/streak';

/** Wednesday 2026-08-05, 14:30 local. */
const NOW = new Date(2026, 7, 5, 14, 30);

function daysAgo(days: number, hour = 9): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days, hour);
}

describe('computeStreak', () => {
  it('returns 0 for an empty list', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('counts consecutive days across day boundaries regardless of time of day', () => {
    const dates = [daysAgo(0, 1), daysAgo(1, 23), daysAgo(2, 12)];
    expect(computeStreak(dates, NOW)).toBe(3);
  });

  it('counts multiple sends on the same day once', () => {
    const dates = [daysAgo(0, 8), daysAgo(0, 18), daysAgo(1, 9)];
    expect(computeStreak(dates, NOW)).toBe(2);
  });

  it('breaks the streak on a gap day', () => {
    const dates = [daysAgo(0), daysAgo(2), daysAgo(3)];
    expect(computeStreak(dates, NOW)).toBe(1);
  });

  it('keeps the streak alive when today is empty but yesterday was active', () => {
    const dates = [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(4)];
    expect(computeStreak(dates, NOW)).toBe(4);
  });

  it('returns 0 when the last send was the day before yesterday', () => {
    const dates = [daysAgo(2), daysAgo(3)];
    expect(computeStreak(dates, NOW)).toBe(0);
  });

  it('spans month boundaries', () => {
    const firstOfMonth = new Date(2026, 7, 1, 10);
    const now = new Date(2026, 7, 1, 12);
    const lastOfJuly = new Date(2026, 6, 31, 22);
    expect(computeStreak([firstOfMonth, lastOfJuly], now)).toBe(2);
  });
});

describe('startOfWeek', () => {
  it('returns Monday 00:00 local for a mid-week date', () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 7, 3)); // Monday Aug 3
  });

  it('treats Sunday as part of the preceding week', () => {
    const sunday = new Date(2026, 7, 9, 23, 59);
    expect(startOfWeek(sunday)).toEqual(new Date(2026, 7, 3));
  });

  it('returns the same day at midnight on a Monday', () => {
    const monday = new Date(2026, 7, 3, 0, 0, 1);
    expect(startOfWeek(monday)).toEqual(new Date(2026, 7, 3));
  });
});
