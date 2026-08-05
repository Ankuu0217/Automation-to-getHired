/*
 * Send-streak + week-window helpers (Phase 9) — pure, local-time based.
 *
 * Day boundaries use the browser's LOCAL midnight (constructed via the
 * Date(y, m, d) constructor so month/year/DST rollovers are handled by the
 * platform, never by ms arithmetic).
 */

/** Local midnight of the given moment. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight `offset` days away (negative = past). */
function shiftDays(day: Date, offset: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
}

/**
 * Week start = Monday 00:00 LOCAL time (ISO-8601 weeks) — chosen so the
 * dashboard's "This week" counter resets Monday morning, matching how
 * people plan job-search sprints. Sunday belongs to the preceding week.
 */
export function startOfWeek(now: Date): Date {
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 = Sunday … 6 = Saturday
  const sinceMonday = (dow + 6) % 7; // Monday → 0, Sunday → 6
  return shiftDays(today, -sinceMonday);
}

/**
 * Consecutive-day send streak: the number of consecutive calendar days with
 * at least one send, counting backwards from today — or from yesterday, so
 * a streak isn't shown as broken before today's sends have happened.
 * Returns 0 when neither today nor yesterday had a send.
 */
export function computeStreak(dates: Date[], now: Date): number {
  const activeDays = new Set(dates.map((d) => startOfDay(d).getTime()));
  let cursor = startOfDay(now);
  if (!activeDays.has(cursor.getTime())) {
    cursor = shiftDays(cursor, -1); // today empty — still alive via yesterday
    if (!activeDays.has(cursor.getTime())) return 0;
  }
  let streak = 0;
  while (activeDays.has(cursor.getTime())) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}
