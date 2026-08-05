import mongoose, { Schema, type Document, type Types } from 'mongoose';
import type {
  EmailDraft,
  JobMatch,
  JobStatus,
  SendFailureCode,
  StoredExtraction,
} from '@jobmail/shared';

/**
 * JobPost — one uploaded LinkedIn job screenshot and everything derived
 * from it (SPEC §3). M3 adds `match` (match analysis) as a sibling subdoc
 * alongside `draft`, without touching the extraction fields.
 */
export interface IJobPost extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** Empty string for pasted-text imports (no screenshot on disk). */
  screenshotPath: string;
  /** Reference link supplied on text import — stored only, NEVER fetched (SSRF). */
  sourceUrl: string | null;
  rawExtractedText: string;
  extraction: StoredExtraction | null;
  status: JobStatus;
  needsEmail: boolean;
  /** Primary HR email: highest-confidence extracted, or user-picked/edited. */
  hrEmail: string | null;
  dedupeHash: string | null;
  /** Last failure reason (extraction error, duplicate at save time). */
  error: string | null;
  /** Machine-readable failure code when the send pipeline failed the job (M3). */
  failureCode: SendFailureCode | null;
  /** Generated/edited outreach email (M3). */
  draft: EmailDraft;
  /** Match analysis jdText vs profile (M3), null until generate-email runs. */
  match: JobMatch | null;
  /** EmailTemplate chosen at generation time (M5), copied to the Application at send. */
  templateId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const hrEmailSubSchema = new Schema(
  {
    email: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const extractionSubSchema = new Schema(
  {
    company: { type: String, default: null },
    role: { type: String, default: null },
    location: { type: String, default: null },
    jdText: { type: String, default: '' },
    hrName: { type: String, default: null },
    hrEmails: { type: [hrEmailSubSchema], default: [] },
    source: { type: String, enum: ['vision', 'ocr'], required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const draftSubSchema = new Schema(
  {
    subject: { type: String, default: '' },
    bodyText: { type: String, default: '' },
    bodyHtml: { type: String, default: '' },
  },
  { _id: false },
);

const matchSubSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    matchedSkills: { type: [String], default: [] },
    gaps: { type: [String], default: [] },
    angle: { type: String, required: true },
  },
  { _id: false },
);

const jobPostSchema = new Schema<IJobPost>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Not required: pasted-text imports (POST /jobs/import) have no screenshot.
    screenshotPath: { type: String, default: '' },
    sourceUrl: { type: String, default: null },
    rawExtractedText: { type: String, default: '' },
    extraction: { type: extractionSubSchema, default: null },
    status: {
      type: String,
      enum: [
        'processing',
        'extracted',
        'needs_review',
        'email_drafted',
        'awaiting_review',
        'queued',
        'sent',
        'failed',
      ],
      default: 'processing',
    },
    needsEmail: { type: Boolean, default: false },
    hrEmail: { type: String, default: null },
    dedupeHash: { type: String, default: null },
    error: { type: String, default: null },
    failureCode: {
      type: String,
      enum: ['MX_INVALID_DOMAIN', 'RESUME_MISSING', 'GMAIL_NOT_CONNECTED', 'SEND_FAILED'],
      default: null,
    },
    draft: { type: draftSubSchema, default: () => ({ subject: '', bodyText: '', bodyHtml: '' }) },
    match: { type: matchSubSchema, default: null },
    templateId: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', default: null },
  },
  { timestamps: true },
);

// Block double-applying at the DB level: one (hrEmail, company, role) combo
// per user. Sparse partial — only rows where dedupeHash is a real string.
jobPostSchema.index(
  { userId: 1, dedupeHash: 1 },
  { unique: true, partialFilterExpression: { dedupeHash: { $type: 'string' } } },
);

export const JobPost =
  (mongoose.models.JobPost as mongoose.Model<IJobPost>) ??
  mongoose.model<IJobPost>('JobPost', jobPostSchema);
