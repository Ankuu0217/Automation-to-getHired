import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type {
  ApplicationEmailKind,
  ApplicationStage,
} from '@jobmail/shared';

/**
 * Application — created when the initial outreach email is actually sent
 * (SPEC §3). One per JobPost; the `emails` thread holds the initial email
 * plus follow-ups (M5) with tracking timestamps (M4).
 */
export interface IApplicationEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  kind: ApplicationEmailKind;
  scheduledAt: Date | null;
  sentAt: Date | null;
  openedAt: Date | null;
  repliedAt: Date | null;
  bouncedAt: Date | null;
  messageId: string | null;
  /** Set when a pending follow-up is cancelled (reply/bounce/terminal stage). */
  cancelledAt: Date | null;
}

export interface IApplication extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  jobPostId: Types.ObjectId;
  hrEmail: string;
  hrName: string | null;
  company: string | null;
  role: string | null;
  stage: ApplicationStage;
  /** EmailTemplate used for the initial outreach (drives per-template stats). */
  templateId: Types.ObjectId | null;
  emails: IApplicationEmail[];
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const emailSubSchema = new Schema<IApplicationEmail>(
  {
    subject: { type: String, required: true },
    bodyText: { type: String, required: true },
    bodyHtml: { type: String, default: '' },
    kind: {
      type: String,
      enum: ['initial', 'followup_1', 'followup_2'] satisfies ApplicationEmailKind[],
      required: true,
    },
    scheduledAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
    messageId: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { _id: false },
);

const applicationSchema = new Schema<IApplication>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jobPostId: { type: Schema.Types.ObjectId, ref: 'JobPost', required: true, unique: true },
    hrEmail: { type: String, required: true, lowercase: true, trim: true },
    hrName: { type: String, default: null },
    company: { type: String, default: null },
    role: { type: String, default: null },
    stage: {
      type: String,
      enum: [
        'applied',
        'hr_screen',
        'interview',
        'offer',
        'rejected',
        'ghosted',
      ] satisfies ApplicationStage[],
      default: 'applied',
    },
    templateId: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', default: null },
    emails: { type: [emailSubSchema], default: [] },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);

// Kanban + send-cap counting both query by (userId, stage / emails.sentAt).
applicationSchema.index({ userId: 1, stage: 1 });
applicationSchema.index({ userId: 1, 'emails.sentAt': 1 });

export const Application =
  (mongoose.models.Application as mongoose.Model<IApplication>) ??
  mongoose.model<IApplication>('Application', applicationSchema);
