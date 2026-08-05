import { Router } from 'express';
import mongoose from 'mongoose';
import { Application } from '../models/Application';
import { EmailEvent } from '../models/EmailEvent';
import { incrementTemplateStat } from '../models/EmailTemplate';
import { createNotification } from '../services/notifications';
import { TRACKING_PIXEL_PNG } from '../services/tracking';
import { logger } from '../utils/logger';

/**
 * GET /api/t/o/:applicationId/:idx.png — open-tracking pixel (SPEC §5/§6).
 *
 * No auth (must load in mail clients), mounted outside /api/v1. Always serves
 * the 1×1 PNG with cache-busting headers — even for unknown/invalid ids —
 * so emails never show a broken image and existence is never leaked. Every
 * hit records an `open` EmailEvent; `openedAt` is set on first open only.
 * Meta is deliberately minimal: user agent only, no IPs (SPEC §8).
 */
export const trackingRouter = Router();

const CACHE_HEADERS: Record<string, string> = {
  'Content-Type': 'image/png',
  'Content-Length': String(TRACKING_PIXEL_PNG.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  // Email clients load the pixel from their own origin — allow cross-origin
  // access explicitly so the image is not blocked (CORP: cross-origin).
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

function sendPixel(res: import('express').Response): void {
  res.set(CACHE_HEADERS);
  res.end(TRACKING_PIXEL_PNG);
}

trackingRouter.get('/o/:applicationId/:idx.png', async (req, res) => {
  try {
    const { applicationId, idx } = req.params;
    const emailIndex = Number.parseInt(idx, 10);

    if (mongoose.isValidObjectId(applicationId) && Number.isInteger(emailIndex) && emailIndex >= 0) {
      const application = await Application.findById(applicationId);
      if (application && emailIndex < application.emails.length) {
        const ua = String(req.headers['user-agent'] ?? '').slice(0, 200);
        await EmailEvent.create({
          applicationId: application._id,
          kind: 'open',
          meta: ua ? { ua } : {},
        });
        // First open wins — later hits only add events.
        if (!application.emails[emailIndex].openedAt) {
          await Application.updateOne(
            { _id: application._id },
            { $set: { [`emails.${emailIndex}.openedAt`]: new Date() } },
          );
          // Per-template A/B stats: first open of the templated initial email.
          if (emailIndex === 0) {
            await incrementTemplateStat(application.templateId, 'opened');
          }
          // Phase 7: first-open notification. Fire-and-forget (not awaited,
          // createNotification never throws) — the already-loaded application
          // carries company/userId, so nothing extra runs on the pixel's
          // critical path.
          void createNotification({
            userId: application.userId,
            kind: 'open',
            applicationId: application._id,
            title: 'Email opened',
            body: `${application.company ?? 'The company'} opened your email.`,
          });
        }
      }
    }
  } catch (err) {
    // Tracking must never break image rendering in the recipient's client.
    logger.warn({ err, path: req.path }, 'Tracking pixel: failed to record open');
  }
  sendPixel(res);
});
