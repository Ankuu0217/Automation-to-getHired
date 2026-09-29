import { z } from 'zod';
import type { SendFailureCode } from './applications.js';
import { toneEnum, type Tone } from './auth.js';
import type { RecentContactInfo } from './contacts.js';
import type { TemplateGuidance } from './templates.js';

/* ── Job post statuses (SPEC §3) ──────────────────────────────────
 * 'processing' and 'needs_review' are M2 additions around the spec's
 * core statuses; the spec statuses are kept intact.
 */
export const jobStatusSchema = z.enum([
  'processing',
  'extracted',
  'needs_review',
  'email_drafted',
  'awaiting_review',
  'queued',
  'sent',
  'failed',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** vision = AI read a screenshot/text · ocr = fallback reader · csv = typed/imported by the user */
export const extractionSourceSchema = z.enum(['vision', 'ocr', 'csv']);
export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

/* ── AI extraction output (SPEC §4 Step A) ──────────────────────── */

export const hrEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  confidence: z.number().min(0).max(1),
});
export type HrEmail = z.infer<typeof hrEmailSchema>;

/** Raw model/OCR extraction result. `source` is attached by the provider, not the model. */
export const jobExtractionSchema = z.object({
  company: z.string().trim().max(200).nullable(),
  role: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  jdText: z.string().max(20000),
  hrName: z.string().trim().max(120).nullable(),
  hrEmails: z.array(hrEmailSchema).max(10),
  confidence: z.number().min(0).max(1),
});
export type JobExtraction = z.infer<typeof jobExtractionSchema>;

/** Extraction as stored on a JobPost (adds source). */
export const storedExtractionSchema = jobExtractionSchema.extend({
  source: extractionSourceSchema,
});
export type StoredExtraction = z.infer<typeof storedExtractionSchema>;

/* ── API payloads ───────────────────────────────────────────────── */

/** PUT /jobs/:id/extraction — user corrections + primary HR email selection. */
export const extractionUpdateSchema = z.object({
  company: z.string().trim().max(200).nullable().optional(),
  role: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  hrName: z.string().trim().max(120).nullable().optional(),
  /** Set/replace the primary HR email (manual entry or picking from the ranked list). */
  hrEmail: z.string().trim().toLowerCase().email().nullable().optional(),
});
export type ExtractionUpdateInput = z.infer<typeof extractionUpdateSchema>;

/**
 * POST /jobs/import — pasted job description text (Phase 2).
 * `sourceUrl` is a reference link only: the server stores it verbatim and
 * NEVER fetches it (SSRF).
 */
export const importJobSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(40, 'Paste at least 40 characters of the job description')
    .max(20000, 'Job description text is limited to 20,000 characters'),
  sourceUrl: z.string().trim().url().max(2000).optional().refine((u) => u === undefined || /^https?:\/\//i.test(u), 'Only http(s) URLs are allowed'),
});
export type ImportJobInput = z.infer<typeof importJobSchema>;

/** POST /jobs/import-csv — rows already mapped to our fields by the client. */
export const MAX_CSV_ROWS = 200;
const csvCell = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => (v ? v : null));
export const csvRowSchema = z.object({
  company: z.string().trim().min(1, 'Company is required').max(200),
  role: z.string().trim().min(1, 'Role is required').max(200),
  hrEmail: z.string().trim().toLowerCase().email('Not a valid email'),
  hrName: csvCell(120),
  location: csvCell(120),
  jdText: csvCell(15000),
  sourceUrl: csvCell(2000),
});
export type CsvRowInput = z.input<typeof csvRowSchema>;
export const importCsvSchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1, 'The file has no rows').max(MAX_CSV_ROWS, `Import up to ${MAX_CSV_ROWS} rows at a time`),
});
export interface ImportCsvResult {
  created: Array<{ row: number; jobId: string; company: string; role: string; hrEmail: string }>;
  skipped: Array<{ row: number; reason: string }>;
}

/** Draft placeholder shape; M3 fills it via generate-email / PUT draft. */
export const emailDraftSchema = z.object({
  subject: z.string().max(300).default(''),
  bodyText: z.string().max(20000).default(''),
  bodyHtml: z.string().max(40000).default(''),
});
export type EmailDraft = z.infer<typeof emailDraftSchema>;

/* ── M3: match analysis + outreach email ────────────────────────── */

/** Match analysis of jdText vs the candidate profile (SPEC §4 Step B). */
export const matchAnalysisSchema = z.object({
  score: z.number().int().min(0).max(100),
  matchedSkills: z.array(z.string().trim().min(1).max(80)).max(30),
  gaps: z.array(z.string().trim().min(1).max(120)).max(20),
  /** Single strongest positioning hook for this candidate + role. */
  angle: z.string().trim().min(1).max(500),
});
export type JobMatch = z.infer<typeof matchAnalysisSchema>;

/** Below this score the draft is still generated but flagged `lowMatch`. */
export const LOW_MATCH_THRESHOLD = 40;

/** Profile data the AI provider needs for match analysis and email writing. */
export interface OutreachProfileSnapshot {
  fullName: string;
  headline: string;
  yearsExp: number | null;
  skills: string[];
  summary: string;
  /** Resume parsed text (may be empty). */
  resumeText: string;
  phone: string;
  links: { linkedin: string; github: string; portfolio: string };
  signature: string;
  /** Sender address shown in the signature (connected Gmail or account email). */
  email?: string;
}

export interface MatchAnalysisInput {
  jdText: string;
  role: string | null;
  company: string | null;
  profile: OutreachProfileSnapshot;
}

export interface OutreachEmailInput {
  extraction: Pick<JobExtraction, 'company' | 'role' | 'location' | 'jdText' | 'hrName'>;
  match: JobMatch;
  profile: OutreachProfileSnapshot;
  tone: Tone;
  /** Recruiter address — a role mailbox (hr@, careers@) means "Dear Hiring Team". */
  hrEmail?: string | null;
  /** When the post advertised several openings: all of them (extraction.role is the one applied for). */
  allRoles?: string[];
  /** Optional template steering (SPEC §4 Step C) — style/structure guidance for the model. */
  template?: TemplateGuidance | null;
}

/** PUT /jobs/:id/draft — manual edit, or tone switch → regenerate with that tone. */
export const draftUpdateSchema = z
  .object({
    subject: z.string().trim().max(300).optional(),
    bodyText: z.string().trim().max(20000).optional(),
    bodyHtml: z.string().trim().max(40000).optional(),
    tone: toneEnum.optional(),
  })
  .refine(
    (d) =>
      d.tone !== undefined ||
      d.subject !== undefined ||
      d.bodyText !== undefined ||
      d.bodyHtml !== undefined,
    { message: 'Provide draft fields to save, or a tone to regenerate with' },
  );
export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;

export interface JobTailoring {
  summary: string;
  highlights: string[];
  keywordsCovered: string[];
  keywordsMissing: string[];
  source: 'ai' | 'basic';
  createdAt: string;
}

/** POST /jobs/:id/find-email */
export interface EmailSuggestion {
  email: string;
  confidence: number;
  source: 'hunter' | 'pattern' | 'role';
  note: string;
}
export interface FindEmailResponse {
  domains: string[];
  suggestions: EmailSuggestion[];
}

export interface JobPostResponse {
  id: string;
  status: JobStatus;
  needsEmail: boolean;
  /** Primary HR email (user-picked or highest-confidence extracted). */
  hrEmail: string | null;
  extraction: StoredExtraction | null;
  rawExtractedText: string;
  draft: EmailDraft;
  match: JobMatch | null;
  /** True when the match score is below LOW_MATCH_THRESHOLD (draft still generated). */
  lowMatch: boolean;
  dedupeHash: string | null;
  /** Last failure reason (extraction error, duplicate at save time) — shown in the UI failed state. */
  error: string | null;
  /** Machine-readable failure code when the send pipeline failed the job (UI keys on this). */
  failureCode: SendFailureCode | null;
  /** EmailTemplate used for generation (null when generated freehand). */
  templateId: string | null;
  /** Reference link supplied on text import — stored only, never fetched (SSRF). */
  sourceUrl: string | null;
  /** When a queued send is due (ISO). Null unless status is 'queued'. */
  sendAt: string | null;
  /** Why the last attempt failed while a retry is pending (queued only). */
  lastAttemptError: string | null;
  /** False for pasted-text imports (no screenshot to serve). */
  hasScreenshot: boolean;
  /** Résumé tailored to this posting, when generated. */
  tailoring: JobTailoring | null;
  /**
   * Non-blocking double-outreach flag (Phase 4): set when the chosen HR email
   * was contacted within the last 14 days on a different application.
   * Only computed on GET /jobs/:id — other routes omit it.
   */
  recentContact?: RecentContactInfo | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobPostSummary {
  id: string;
  status: JobStatus;
  needsEmail: boolean;
  company: string | null;
  role: string | null;
  hrEmail: string | null;
  source: ExtractionSource | null;
  confidence: number | null;
  /** When a queued send is due (ISO). Null unless status is 'queued'. */
  sendAt: string | null;
  /** Why the last attempt failed while a retry is pending (queued only). */
  lastAttemptError: string | null;
  /** Why a send failed (status 'failed'), for the Dispatches failed list. */
  error: string | null;
  failureCode: SendFailureCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadJobResponse {
  jobPostId: string;
}
