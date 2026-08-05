import type { Types } from 'mongoose';
import type { NotificationKind } from '@jobmail/shared';
import { Notification } from '../models/Notification';
import { logger } from '../utils/logger';

/**
 * Notification emission (Phase 7). Every call site is fire-and-forget:
 * `void createNotification({...})` — this helper NEVER throws (all failures
 * are logged and swallowed) so it can hang off the tracking pixel, the send
 * pipeline and the reminder job without blocking or breaking any of them.
 */

/** Per-user history cap — older notifications beyond this are pruned. */
export const NOTIFICATION_HISTORY_CAP = 100;

export interface CreateNotificationInput {
  userId: string | Types.ObjectId;
  kind: NotificationKind;
  applicationId: string | Types.ObjectId;
  title: string;
  body: string;
}

/**
 * Insert a notification, then enforce the per-user cap.
 *
 * Cap approach (cheap, skip-based): after the insert, fetch only the _ids
 * beyond the newest NOTIFICATION_HISTORY_CAP (sort newest-first, skip the
 * cap) and deleteMany them. In the steady state the skip query returns zero
 * rows, so the common cost is one indexed find on { userId, createdAt: -1 }.
 * Best-effort: a failed prune only leaves a slightly longer history.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    await Notification.create({
      userId: input.userId,
      kind: input.kind,
      applicationId: input.applicationId,
      title: input.title,
      body: input.body,
    });

    const overflow = await Notification.find({ userId: input.userId })
      .sort({ createdAt: -1, _id: -1 })
      .skip(NOTIFICATION_HISTORY_CAP)
      .select('_id')
      .lean();
    if (overflow.length > 0) {
      await Notification.deleteMany({ _id: { $in: overflow.map((n) => n._id) } });
    }
  } catch (err) {
    // Fire-and-forget by contract: never propagate into the caller's path.
    logger.warn({ err, kind: input.kind }, 'notification: create failed');
  }
}
