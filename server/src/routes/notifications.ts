import { Router } from 'express';
import mongoose from 'mongoose';
import {
  ErrorCodes,
  type NotificationEnvelope,
  type NotificationListResponse,
  type NotificationReadAllResponse,
  type NotificationResponse,
} from '@jobmail/shared';
import { Notification, type INotification } from '../models/Notification';
import { AppError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';

/**
 * Notifications API (Phase 7) — feeds the Nav bell dropdown. Read-side only:
 * emission happens fire-and-forget at the event sources (tracking pixel,
 * mark-replied, bounce recording, interview reminder) via
 * services/notifications.ts.
 */
export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

/** How many notifications the dropdown shows (history itself caps at 100). */
const LIST_LIMIT = 50;

function toDto(notification: INotification): NotificationResponse {
  return {
    id: String(notification._id),
    kind: notification.kind,
    applicationId: String(notification.applicationId),
    title: notification.title,
    body: notification.body,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  };
}

/** GET /notifications — newest 50 + unread badge count. */
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: req.userId! })
        .sort({ createdAt: -1, _id: -1 })
        .limit(LIST_LIMIT),
      Notification.countDocuments({ userId: req.userId!, read: false }),
    ]);
    const body: NotificationListResponse = {
      notifications: notifications.map(toDto),
      unreadCount,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/** PATCH /notifications/:id/read — mark one read (ownership-scoped, 404 else). */
notificationsRouter.patch('/:id/read', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Notification not found');
    }
    // Ownership-scoped update: cross-user access is indistinguishable from missing.
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId! },
      { $set: { read: true } },
      { new: true },
    );
    if (!notification) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Notification not found');
    }
    const body: NotificationEnvelope = { notification: toDto(notification) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/** POST /notifications/read-all — mark every unread notification read. */
notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.userId!, read: false },
      { $set: { read: true } },
    );
    const body: NotificationReadAllResponse = { updated: result.modifiedCount };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
