/**
 * Pure send-scheduling logic (SPEC §5): jitter + daily/hourly caps.
 * Kept free of DB/Agenda imports so it unit-tests without any infrastructure.
 */

export const HOURLY_SEND_CAP = 10;
export const JITTER_MIN_MINUTES = 2;
export const JITTER_MAX_MINUTES = 8;
/** Overflow window: next-day sends land at a recipient-plausible 9–11 AM. */
const NEXT_DAY_WINDOW_START_HOUR = 9;
const NEXT_DAY_WINDOW_HOURS = 2;

export interface SendTimeInput {
  /** Earliest desired send time (user-requested schedule, or now). */
  base: Date;
  /** Emails already sent since local midnight. */
  sentToday: number;
  /** Emails already sent in the current hour. */
  sentThisHour: number;
  /** User's dailySendCap setting. */
  dailyCap: number;
  hourlyCap?: number;
  /** Injectable RNG ([0,1)) for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

/**
 * Compute the actual send time:
 *  - normal case: base + 2–8 min random jitter (spacing between sends);
 *  - hourly cap reached: pushed to the next hour boundary (+ jitter);
 *  - daily cap reached: pushed to next day at a random time in 9–11 AM.
 */
export function computeSendTime(input: SendTimeInput): Date {
  const random = input.random ?? Math.random;
  const hourlyCap = input.hourlyCap ?? HOURLY_SEND_CAP;
  const jitterMs =
    (JITTER_MIN_MINUTES + random() * (JITTER_MAX_MINUTES - JITTER_MIN_MINUTES)) * 60 * 1000;

  if (input.sentToday >= input.dailyCap) {
    const next = new Date(input.base);
    next.setDate(next.getDate() + 1);
    next.setHours(NEXT_DAY_WINDOW_START_HOUR, 0, 0, 0);
    return new Date(next.getTime() + random() * NEXT_DAY_WINDOW_HOURS * 60 * 60 * 1000);
  }

  if (input.sentThisHour >= hourlyCap) {
    const nextHour = new Date(input.base);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    return new Date(nextHour.getTime() + jitterMs);
  }

  return new Date(input.base.getTime() + jitterMs);
}
