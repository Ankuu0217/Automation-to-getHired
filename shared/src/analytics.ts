import { z } from 'zod';
import { toneEnum } from './auth.js';

/* ── Analytics (SPEC §6 GET /analytics/funnel, M5) ──────────────────────
 * Application-level funnel: one application counts once per stage of the
 * funnel regardless of how many emails (initial + follow-ups) it holds.
 * Rates are 0–1 floats, 0 when the denominator is 0.
 */

export const funnelTotalsSchema = z.object({
  /** Applications with at least one sent email. */
  sent: z.number().int().min(0),
  /** Applications where any email was opened. */
  opened: z.number().int().min(0),
  /** Applications where any email got a reply. */
  replied: z.number().int().min(0),
  /** Applications currently in interview or offer stage. */
  interviews: z.number().int().min(0),
  /** Applications currently in offer stage. */
  offers: z.number().int().min(0),
});
export type FunnelTotals = z.infer<typeof funnelTotalsSchema>;

export const funnelRatesSchema = z.object({
  /** opened / sent */
  openRate: z.number().min(0).max(1),
  /** replied / sent */
  replyRate: z.number().min(0).max(1),
  /** (replied, or stage hr_screen/interview/offer) / sent — any positive response. */
  responseRate: z.number().min(0).max(1),
});
export type FunnelRates = z.infer<typeof funnelRatesSchema>;

export const perTemplateStatsSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  sent: z.number().int().min(0),
  opened: z.number().int().min(0),
  replied: z.number().int().min(0),
  /** replied / sent, 0 when sent is 0. */
  replyRate: z.number().min(0).max(1),
});
export type PerTemplateStats = z.infer<typeof perTemplateStatsSchema>;

/** One day of the 30-day activity trend (date is UTC YYYY-MM-DD). */
export const funnelTrendPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sent: z.number().int().min(0),
  opened: z.number().int().min(0),
  replied: z.number().int().min(0),
});
export type FunnelTrendPoint = z.infer<typeof funnelTrendPointSchema>;

export const funnelAnalyticsResponseSchema = z.object({
  totals: funnelTotalsSchema,
  rates: funnelRatesSchema,
  perTemplate: z.array(perTemplateStatsSchema),
  /** Daily series for the last 30 days (oldest first, ending today, UTC). */
  trend: z.array(funnelTrendPointSchema),
});
export type FunnelAnalyticsResponse = z.infer<typeof funnelAnalyticsResponseSchema>;

/* ── Phase 5: analytics upgrades ─────────────────────────────────────────
 * Four additive endpoints. All counts are cheap scans over the user's
 * Application email subdocs (same source of truth as the funnel); rates are
 * 0–1 floats, 0 when the denominator is 0.
 */

/** One hour-of-day slot for GET /analytics/timing. */
export const timingHourStatSchema = z.object({
  /** Hour of day (0–23) of sentAt, in the API server's local timezone. */
  hour: z.number().int().min(0).max(23),
  /** Emails (initial + follow-ups) sent during this hour of day. */
  sent: z.number().int().min(0),
  /** Of those, emails that were later opened. */
  opened: z.number().int().min(0),
  /** opened / sent, 0 when sent is 0. */
  openRate: z.number().min(0).max(1),
});
export type TimingHourStat = z.infer<typeof timingHourStatSchema>;

/**
 * GET /analytics/timing. `hours` ALWAYS holds all 24 slots in order
 * (hour 0 → 23); slots with no sends carry sent/opened/openRate of 0 — a
 * zero send count is a true value, so the client can chart the full day.
 * `bestHour` is the hour with the highest openRate among hours with
 * sent > 0 (ties: more sent, then earlier hour); null when nothing sent.
 */
export const timingAnalyticsResponseSchema = z.object({
  hours: z.array(timingHourStatSchema),
  bestHour: z.number().int().min(0).max(23).nullable(),
});
export type TimingAnalyticsResponse = z.infer<typeof timingAnalyticsResponseSchema>;

/** One template row for GET /analytics/by-template. */
export const templateUsageStatSchema = z.object({
  /** Template id, or null for the aggregate 'No template' row. */
  templateId: z.string().nullable(),
  /** Template name; 'No template' / 'Deleted template' for unresolved ids. */
  name: z.string(),
  /** Applications using this template with at least one sent email. */
  sent: z.number().int().min(0),
  /** Of those, applications where any email was opened. */
  opened: z.number().int().min(0),
  /** Of those, applications where any email got a reply. */
  replied: z.number().int().min(0),
  /** replied / sent, 0 when sent is 0. */
  replyRate: z.number().min(0).max(1),
});
export type TemplateUsageStat = z.infer<typeof templateUsageStatSchema>;

/**
 * GET /analytics/by-template. Aggregated from Application email subdocs
 * (NOT EmailTemplate.stats — those are best-effort counters that miss
 * templateless sends and vanish with deleted templates). Only rows with
 * sent > 0 are returned, ordered by sent desc then name asc.
 */
export const templateAnalyticsResponseSchema = z.object({
  templates: z.array(templateUsageStatSchema),
});
export type TemplateAnalyticsResponse = z.infer<typeof templateAnalyticsResponseSchema>;

/** One tone row for GET /analytics/by-tone. */
export const toneUsageStatSchema = z.object({
  tone: toneEnum,
  /** Applications sent with a template of this tone (any sentAt email). */
  sent: z.number().int().min(0),
  /** Of those, applications where any email got a reply. */
  replied: z.number().int().min(0),
  /** replied / sent, 0 when sent is 0. */
  replyRate: z.number().min(0).max(1),
});
export type ToneUsageStat = z.infer<typeof toneUsageStatSchema>;

/**
 * GET /analytics/by-tone. Tone is not persisted per draft (it is resolved
 * transiently at generation time), so tone comes from the template used:
 * Application.templateId → EmailTemplate.tone. Templateless sends and
 * deleted templates are excluded. Only tones with sent > 0 are returned,
 * in enum order (formal, confident, friendly).
 */
export const toneAnalyticsResponseSchema = z.object({
  tones: z.array(toneUsageStatSchema),
});
export type ToneAnalyticsResponse = z.infer<typeof toneAnalyticsResponseSchema>;

/** Fixed histogram bands for sentAt → repliedAt latency. */
export const responseTimeBucketLabelSchema = z.enum([
  '<1h',
  '1-4h',
  '4-24h',
  '1-3d',
  '3-7d',
  '>7d',
]);
export type ResponseTimeBucketLabel = z.infer<typeof responseTimeBucketLabelSchema>;

export const responseTimeBucketSchema = z.object({
  label: responseTimeBucketLabelSchema,
  /** Replied emails whose sentAt → repliedAt delta falls in this band. */
  count: z.number().int().min(0),
});
export type ResponseTimeBucket = z.infer<typeof responseTimeBucketSchema>;

/**
 * GET /analytics/response-time. `buckets` ALWAYS holds all six bands in
 * order (a zero count is a true histogram value). `medianHours` is the
 * median sentAt → repliedAt delta in hours (2-decimal float), null when no
 * email has both timestamps.
 */
export const responseTimeAnalyticsResponseSchema = z.object({
  buckets: z.array(responseTimeBucketSchema),
  medianHours: z.number().min(0).nullable(),
});
export type ResponseTimeAnalyticsResponse = z.infer<typeof responseTimeAnalyticsResponseSchema>;
