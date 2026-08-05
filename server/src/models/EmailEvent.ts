import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { EmailEventKind } from '@jobmail/shared';

/**
 * EmailEvent (SPEC §3) — one tracking event on an application: open, bounce,
 * or reply. Every event is recorded (no dedupe); the derived timestamps on
 * Application.emails[] hold the first occurrence. `meta` stays minimal —
 * for opens just the user agent, never IPs (SPEC §8 privacy).
 */
export interface IEmailEvent extends Document {
  _id: Types.ObjectId;
  applicationId: Types.ObjectId;
  kind: EmailEventKind;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const emailEventSchema = new Schema<IEmailEvent>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['open', 'bounce', 'reply'] satisfies EmailEventKind[],
      required: true,
    },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const EmailEvent =
  (mongoose.models.EmailEvent as mongoose.Model<IEmailEvent>) ??
  mongoose.model<IEmailEvent>('EmailEvent', emailEventSchema);
