import { env } from '../config/env';

/**
 * Open-tracking pixel (SPEC §5). The route serving it lives in
 * routes/tracking.ts; this module holds the shared constants and the HTML
 * injection helper so M5 follow-up sends can reuse the same pixel wiring.
 */

/** 1×1 transparent PNG (67 bytes). */
export const TRACKING_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export function trackingPixelUrl(applicationId: string, emailIndex: number): string {
  return `${env.API_URL}/api/t/o/${applicationId}/${emailIndex}.png`;
}

/**
 * Append the tracking pixel to an HTML email body. Called with the final
 * applicationId/emailIndex at send time, so the send pipeline must know the
 * Application id before composing the HTML it sends.
 */
export function injectTrackingPixel(
  html: string,
  applicationId: string,
  emailIndex: number,
): string {
  const url = trackingPixelUrl(applicationId, emailIndex);
  const img = `<img src="${url}" width="1" height="1" alt="" style="display:none" />`;
  if (html.includes('</body>')) return html.replace('</body>', `${img}</body>`);
  return `${html}${img}`;
}
