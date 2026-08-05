import { z } from 'zod';

/* ── Notifications (Phase 7) — open / reply / interview / bounce ──── */

export const notificationKindSchema = z.enum(['open', 'reply', 'interview', 'bounce']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** One in-app notification as the API returns it (dates ISO-serialized). */
export const notificationSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  /** The Application the event happened on (row click deep-links the pipeline). */
  applicationId: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationResponse = z.infer<typeof notificationSchema>;

/** GET /notifications — newest 50 plus the unread badge count. */
export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

/** PATCH /notifications/:id/read — the updated notification. */
export const notificationEnvelopeSchema = z.object({
  notification: notificationSchema,
});
export type NotificationEnvelope = z.infer<typeof notificationEnvelopeSchema>;

/** POST /notifications/read-all — how many were flipped to read. */
export const notificationReadAllResponseSchema = z.object({
  updated: z.number().int(),
});
export type NotificationReadAllResponse = z.infer<typeof notificationReadAllResponseSchema>;
