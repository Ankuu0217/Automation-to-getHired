import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getFunnelAnalytics,
  getResponseTimeAnalytics,
  getTemplateAnalytics,
  getTimingAnalytics,
  getToneAnalytics,
} from '../services/analytics';

/**
 * Analytics API (SPEC §6, M5) — the funnel behind the dashboard stat cards,
 * per-template A/B table, and 30-day activity chart.
 */
export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

/** GET /analytics/funnel — totals, rates, per-template stats, 30-day trend. */
analyticsRouter.get('/funnel', async (req, res, next) => {
  try {
    res.json(await getFunnelAnalytics(req.userId!));
  } catch (err) {
    next(err);
  }
});

/* ── Phase 5: analytics upgrades (all additive) ─────────────────────── */

/** GET /analytics/timing — send hour-of-day vs open rate, 24 slots + bestHour. */
analyticsRouter.get('/timing', async (req, res, next) => {
  try {
    res.json(await getTimingAnalytics(req.userId!));
  } catch (err) {
    next(err);
  }
});

/** GET /analytics/by-template — per-template sends/opens/replies from application data. */
analyticsRouter.get('/by-template', async (req, res, next) => {
  try {
    res.json(await getTemplateAnalytics(req.userId!));
  } catch (err) {
    next(err);
  }
});

/** GET /analytics/by-tone — reply rate by template tone. */
analyticsRouter.get('/by-tone', async (req, res, next) => {
  try {
    res.json(await getToneAnalytics(req.userId!));
  } catch (err) {
    next(err);
  }
});

/** GET /analytics/response-time — sentAt → repliedAt latency histogram + median. */
analyticsRouter.get('/response-time', async (req, res, next) => {
  try {
    res.json(await getResponseTimeAnalytics(req.userId!));
  } catch (err) {
    next(err);
  }
});
