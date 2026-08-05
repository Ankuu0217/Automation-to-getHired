import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type { Tone } from '@jobmail/shared';
import { logger } from '../utils/logger';

/**
 * EmailTemplate (SPEC §3) — a reusable outreach style the AI provider uses
 * as generation guidance, with per-template funnel stats for A/B insight.
 * Invariant: at most one `isDefault` per user (enforced by the routes).
 */
export interface IEmailTemplate extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  tone: Tone;
  subjectTemplate: string;
  bodyTemplate: string;
  isDefault: boolean;
  stats: { sent: number; opened: number; replied: number };
  createdAt: Date;
  updatedAt: Date;
}

const emailTemplateSchema = new Schema<IEmailTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    tone: {
      type: String,
      enum: ['formal', 'confident', 'friendly'] satisfies Tone[],
      required: true,
    },
    subjectTemplate: { type: String, required: true, trim: true, maxlength: 300 },
    bodyTemplate: { type: String, required: true, trim: true, maxlength: 20000 },
    isDefault: { type: Boolean, default: false },
    stats: {
      sent: { type: Number, default: 0, min: 0 },
      opened: { type: Number, default: 0, min: 0 },
      replied: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true },
);

export const EmailTemplate =
  (mongoose.models.EmailTemplate as mongoose.Model<IEmailTemplate>) ??
  mongoose.model<IEmailTemplate>('EmailTemplate', emailTemplateSchema);

export type TemplateStatField = 'sent' | 'opened' | 'replied';

/**
 * Best-effort stats bump (SPEC §5 A/B insight). Never throws — stats must
 * not break the send/tracking pipeline that calls this.
 */
export async function incrementTemplateStat(
  templateId: Types.ObjectId | string | null | undefined,
  field: TemplateStatField,
): Promise<void> {
  if (!templateId) return;
  try {
    await EmailTemplate.updateOne({ _id: templateId }, { $inc: { [`stats.${field}`]: 1 } });
  } catch (err) {
    logger.warn({ err, templateId: String(templateId), field }, 'Template stats increment failed');
  }
}
