import { z } from 'zod';

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
