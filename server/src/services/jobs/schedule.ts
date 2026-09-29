/**
 * Pure send-scheduling logic (SPEC §5): caps + burst spacing.
 * Kept free of DB/Agenda imports so it unit-tests without any infrastructure.
 *
 * The user clicked "Send now" — so the email goes out NOW. We only hold a send
 * back when it protects the user's Gmail reputation:
 *   - they asked for a specific future time  → honored exactly;
 *   - a burst (3+ sends in the last 10 min)  → this one trails the previous by 30–90 s;
 *   - hourly cap (10) reached                → next hour;
 *   - daily cap reached                      → next day, 9–11 AM.
 */

export const HOURLY_SEND_CAP = 10;
/** This many sends inside BURST_WINDOW_MS go out instantly; from the next one on they're spaced. */
export const BURST_FREE_SENDS = 3;
export const BURST_WINDOW_MS = 10 * 60 * 1000;
export const SPACING_MIN_SECONDS = 30;
export const SPACING_MAX_SECONDS = 90;
/** Overflow window: next-day sends land at a recipient-plausible 9–11 AM. */
const NEXT_DAY_WINDOW_START_HOUR = 9;
const NEXT_DAY_WINDOW_HOURS = 2;

export interface SendTimeInput {
  /** Earliest desired send time (user-requested schedule, or now). */
  base: Date;
  /** "Now" — injectable for tests. Defaults to the wall clock. */
  now?: Date;
  /** Emails sent or queued for today (local day). */
  sentToday: number;
  /** Emails sent or queued for the current hour. */
  sentThisHour: number;
  /** User's dailySendCap setting. */
  dailyCap: number;
  hourlyCap?: number;
  /** Sends done or queued within BURST_WINDOW_MS of now. */
  recentSends?: number;
  /** Latest send/queued time among those recent sends (spacing anchors on it). */
  lastActivityAt?: Date | null;
  /** Injectable RNG ([0,1)) for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

/**
 * Compute the actual send time — `base` (≈ now) in the normal case.
 */
export function computeSendTime(input: SendTimeInput): Date {
  const random = input.random ?? Math.random;
  const now = input.now ?? new Date();
  const hourlyCap = input.hourlyCap ?? HOURLY_SEND_CAP;
  const gapMs = () =>
    (SPACING_MIN_SECONDS + random() * (SPACING_MAX_SECONDS - SPACING_MIN_SECONDS)) * 1000;

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
    return new Date(nextHour.getTime() + gapMs());
  }

  // A time the user picked is honored to the second — no spacing games.
  if (input.base.getTime() > now.getTime() + 1000) return new Date(input.base);

  const recent = input.recentSends ?? 0;
  if (recent >= BURST_FREE_SENDS && input.lastActivityAt) {
    const spaced = input.lastActivityAt.getTime() + gapMs();
    return new Date(Math.max(input.base.getTime(), spaced));
  }

  return new Date(input.base);
}
