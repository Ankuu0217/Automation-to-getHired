import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { NotificationKind } from '@jobmail/shared';

/**
 * Notification (Phase 7) — one in-app event for the Nav bell: first email
 * open, reply, interview reminder, or bounce. Emission is always
 * fire-and-forget (services/notifications.ts createNotification) so a lost
 * notification can never break the pixel/send paths. History is capped at
 * NOTIFICATION_HISTORY_CAP (100) per user by the helper.
 */
export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: NotificationKind;
  applicationId: Types.ObjectId;
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: {
      type: String,
      enum: ['open', 'reply', 'interview', 'bounce'] satisfies NotificationKind[],
      required: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Bell dropdown + unread badge both query by (userId, newest-first).
notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification =
  (mongoose.models.Notification as mongoose.Model<INotification>) ??
  mongoose.model<INotification>('Notification', notificationSchema);
