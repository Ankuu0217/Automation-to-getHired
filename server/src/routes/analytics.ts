import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getFunnelAnalytics } from '../services/analytics';

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
