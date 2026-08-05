import { Application } from '../models/Application';
import { EmailEvent } from '../models/EmailEvent';
import { EmailTemplate } from '../models/EmailTemplate';
import type { FunnelAnalyticsResponse, FunnelTrendPoint } from '@jobmail/shared';

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
