import { Application } from '../models/Application';
import { EmailEvent } from '../models/EmailEvent';
import { EmailTemplate } from '../models/EmailTemplate';
import type {
  FunnelAnalyticsResponse,
  FunnelTrendPoint,
  ResponseTimeAnalyticsResponse,
  ResponseTimeBucketLabel,
  TemplateAnalyticsResponse,
  TemplateUsageStat,
  TimingAnalyticsResponse,
  Tone,
  ToneAnalyticsResponse,
} from '@jobmail/shared';

/**
 * Funnel analytics (SPEC §6, M5). Application-level funnel: one application
 * counts once per funnel stage no matter how many emails its thread holds.
 * Plain Mongoose queries — the per-user data volume doesn't justify an
 * aggregation pipeline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;

/** UTC day bucket key (YYYY-MM-DD) — keeps the trend series tz-stable. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0–1 rate rounded to 4 decimals; 0 when the denominator is 0. */
function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export async function getFunnelAnalytics(
  userId: string,
  now: Date = new Date(),
): Promise<FunnelAnalyticsResponse> {
  const applications = await Application.find({ userId })
    .select('stage templateId emails.sentAt emails.openedAt emails.repliedAt')
    .lean();

  const hasSent = (a: (typeof applications)[number]) => a.emails.some((e) => e.sentAt);
  const sent = applications.filter(hasSent).length;
  const opened = applications.filter((a) => a.emails.some((e) => e.openedAt)).length;
  const replied = applications.filter((a) => a.emails.some((e) => e.repliedAt)).length;
  const interviews = applications.filter((a) => a.stage === 'interview' || a.stage === 'offer').length;
  const offers = applications.filter((a) => a.stage === 'offer').length;
  // Any positive signal: a reply, or the user advanced the pipeline.
  const responded = applications.filter(
    (a) =>
      a.emails.some((e) => e.repliedAt) ||
      a.stage === 'hr_screen' ||
      a.stage === 'interview' ||
      a.stage === 'offer',
  ).length;

  const templates = await EmailTemplate.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).lean();
  const perTemplate = templates.map((t) => ({
    templateId: String(t._id),
    name: t.name,
    sent: t.stats.sent,
    opened: t.stats.opened,
    replied: t.stats.replied,
    replyRate: rate(t.stats.replied, t.stats.sent),
  }));

  // ── 30-day trend: sends from email timestamps, opens/replies from events ──
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(todayStart.getTime() - (TREND_DAYS - 1) * DAY_MS);
  const days = new Map<string, FunnelTrendPoint>();
  for (let i = 0; i < TREND_DAYS; i += 1) {
    const key = utcDayKey(new Date(start.getTime() + i * DAY_MS));
    days.set(key, { date: key, sent: 0, opened: 0, replied: 0 });
  }

  for (const application of applications) {
    for (const email of application.emails) {
      if (email.sentAt && email.sentAt >= start) {
        const point = days.get(utcDayKey(new Date(email.sentAt)));
        if (point) point.sent += 1;
      }
    }
  }

  const applicationIds = applications.map((a) => a._id);
  if (applicationIds.length > 0) {
    const events = await EmailEvent.find({
      applicationId: { $in: applicationIds },
      kind: { $in: ['open', 'reply'] },
      createdAt: { $gte: start },
    })
      .select('kind createdAt')
      .lean();
    for (const event of events) {
      const point = days.get(utcDayKey(new Date(event.createdAt)));
      if (!point) continue;
      if (event.kind === 'open') point.opened += 1;
      else point.replied += 1;
    }
  }

  return {
    totals: { sent, opened, replied, interviews, offers },
    rates: {
      openRate: rate(opened, sent),
      replyRate: rate(replied, sent),
      responseRate: rate(responded, sent),
    },
    perTemplate,
    trend: [...days.values()],
  };
}

/* ── Phase 5: analytics upgrades ─────────────────────────────────────────
 * Four additive read-only aggregations. Same philosophy as the funnel:
 * plain Mongoose scans over the user's applications — per-user volume
 * doesn't justify aggregation pipelines. Every query filters on userId
 * first (ownership scoping).
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * GET /analytics/timing. Buckets each sent email (initial + follow-ups) by
 * the hour-of-day of its sentAt and whether that same email was opened.
 *
 * TIMEZONE CAVEAT: sentAt is stored as UTC; `getHours()` interprets it in
 * the API server's local timezone, which stands in for the user's timezone
 * (no per-user tz preference exists yet). Users in a different tz from the
 * server will see shifted hours.
 *
 * Returns ALL 24 hour slots (zero send counts are true values so the chart
 * can draw the whole day). bestHour = highest openRate among hours with
 * sent > 0; ties broken by more sent, then the earlier hour; null when the
 * user has sent nothing.
 */
export async function getTimingAnalytics(userId: string): Promise<TimingAnalyticsResponse> {
  const applications = await Application.find({ userId })
    .select('emails.sentAt emails.openedAt')
    .lean();

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, sent: 0, opened: 0, openRate: 0 }));
  for (const application of applications) {
    for (const email of application.emails) {
      if (!email.sentAt) continue;
      const slot = hours[new Date(email.sentAt).getHours()];
      slot.sent += 1;
      if (email.openedAt) slot.opened += 1;
    }
  }

  let bestHour: number | null = null;
  for (const slot of hours) {
    slot.openRate = rate(slot.opened, slot.sent);
    if (slot.sent === 0) continue;
    const best = bestHour === null ? null : hours[bestHour];
    if (
      best === null ||
      slot.openRate > best.openRate ||
      (slot.openRate === best.openRate && slot.sent > best.sent)
    ) {
      bestHour = slot.hour;
    }
  }

  return { hours, bestHour };
}

/**
 * GET /analytics/by-template. Application-level counts (matching the
 * funnel's semantics: an application counts once per stat no matter how
 * many thread emails match), grouped by Application.templateId.
 *
 * SOURCE DECISION: aggregated from Application email subdocs, NOT from
 * EmailTemplate.stats. The stats counters are best-effort fire-and-forget
 * ($inc that never throws), are never decremented, disappear when a
 * template is deleted, only bump 'opened' on the first open of the initial
 * email, and cannot represent templateless sends. The subdoc scan is the
 * same one the funnel already does, so it is equally cheap and always
 * consistent with the other panels.
 *
 * Rows: one per template with sent > 0 (name resolved from the user's
 * templates; 'Deleted template' when the id no longer resolves) plus a
 * 'No template' row (templateId: null) when templateless sends exist.
 * Ordered by sent desc, then name asc.
 */
export async function getTemplateAnalytics(userId: string): Promise<TemplateAnalyticsResponse> {
  const applications = await Application.find({ userId })
    .select('templateId emails.sentAt emails.openedAt emails.repliedAt')
    .lean();
  const templates = await EmailTemplate.find({ userId }).select('name').lean();
  const names = new Map(templates.map((t) => [String(t._id), t.name]));

  const groups = new Map<string | null, { sent: number; opened: number; replied: number }>();
  for (const application of applications) {
    if (!application.emails.some((e) => e.sentAt)) continue;
    const key = application.templateId ? String(application.templateId) : null;
    const group = groups.get(key) ?? { sent: 0, opened: 0, replied: 0 };
    group.sent += 1;
    if (application.emails.some((e) => e.openedAt)) group.opened += 1;
    if (application.emails.some((e) => e.repliedAt)) group.replied += 1;
    groups.set(key, group);
  }

  const rows: TemplateUsageStat[] = [...groups.entries()].map(([templateId, g]) => ({
    templateId,
    name:
      templateId === null ? 'No template' : (names.get(templateId) ?? 'Deleted template'),
    sent: g.sent,
    opened: g.opened,
    replied: g.replied,
    replyRate: rate(g.replied, g.sent),
  }));
  rows.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));

  return { templates: rows };
}

const TONE_ORDER: Tone[] = ['formal', 'confident', 'friendly'];

/**
 * GET /analytics/by-tone. Tone is NOT persisted per draft (generation
 * resolves it transiently from user settings / the request and stores only
 * templateId on the JobPost, copied to the Application at send time), so
 * the only durable tone linkage is Application.templateId →
 * EmailTemplate.tone. Templateless sends and deleted templates are
 * excluded — their tone is unknown. Application-level counts; only tones
 * with sent > 0 are returned, in enum order.
 */
export async function getToneAnalytics(userId: string): Promise<ToneAnalyticsResponse> {
  const applications = await Application.find({ userId })
    .select('templateId emails.sentAt emails.repliedAt')
    .lean();
  const templates = await EmailTemplate.find({ userId }).select('tone').lean();
  const toneById = new Map(templates.map((t) => [String(t._id), t.tone]));

  const counts = new Map<Tone, { sent: number; replied: number }>();
  for (const application of applications) {
    if (!application.templateId || !application.emails.some((e) => e.sentAt)) continue;
    const tone = toneById.get(String(application.templateId));
    if (!tone) continue; // deleted template — tone unknown
    const group = counts.get(tone) ?? { sent: 0, replied: 0 };
    group.sent += 1;
    if (application.emails.some((e) => e.repliedAt)) group.replied += 1;
    counts.set(tone, group);
  }

  return {
    tones: TONE_ORDER.filter((tone) => counts.has(tone)).map((tone) => {
      const g = counts.get(tone)!;
      return { tone, sent: g.sent, replied: g.replied, replyRate: rate(g.replied, g.sent) };
    }),
  };
}

/** Histogram bands: [label, upper bound in hours) — last band is open. */
const RESPONSE_TIME_BANDS: { label: ResponseTimeBucketLabel; maxHours: number }[] = [
  { label: '<1h', maxHours: 1 },
  { label: '1-4h', maxHours: 4 },
  { label: '4-24h', maxHours: 24 },
  { label: '1-3d', maxHours: 72 },
  { label: '3-7d', maxHours: 168 },
  { label: '>7d', maxHours: Infinity },
];

/**
 * GET /analytics/response-time. Distribution of sentAt → repliedAt deltas
 * across every email (initial + follow-ups) carrying both timestamps.
 * Always returns all six bands in order (zero counts are true histogram
 * values); medianHours is the median delta in hours (2 decimals), null
 * when no replies exist.
 */
export async function getResponseTimeAnalytics(
  userId: string,
): Promise<ResponseTimeAnalyticsResponse> {
  const applications = await Application.find({ userId })
    .select('emails.sentAt emails.repliedAt')
    .lean();

  const deltasHours: number[] = [];
  for (const application of applications) {
    for (const email of application.emails) {
      if (!email.sentAt || !email.repliedAt) continue;
      const delta = (email.repliedAt.getTime() - email.sentAt.getTime()) / HOUR_MS;
      if (delta >= 0) deltasHours.push(delta);
    }
  }

  const buckets = RESPONSE_TIME_BANDS.map((band) => ({ label: band.label, count: 0 }));
  for (const delta of deltasHours) {
    const index = RESPONSE_TIME_BANDS.findIndex((band) => delta < band.maxHours);
    buckets[index === -1 ? buckets.length - 1 : index].count += 1;
  }

  let medianHours: number | null = null;
  if (deltasHours.length > 0) {
    const sorted = [...deltasHours].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    medianHours = Math.round(median * 100) / 100;
  }

  return { buckets, medianHours };
}
