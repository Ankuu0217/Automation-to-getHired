import { z } from 'zod';

/* ── Applications (SPEC §3) — created when an outreach email is sent ── */

export const applicationStageSchema = z.enum([
  'applied',
  'hr_screen',
  'interview',
  'offer',
  'rejected',
  'ghosted',
]);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

export const applicationEmailKindSchema = z.enum(['initial', 'followup_1', 'followup_2']);
export type ApplicationEmailKind = z.infer<typeof applicationEmailKindSchema>;

/** One email in an application's thread (initial + follow-ups). */
export const applicationEmailSchema = z.object({
  subject: z.string().max(300),
  bodyText: z.string().max(20000),
  bodyHtml: z.string().max(40000),
  kind: applicationEmailKindSchema,
  scheduledAt: z.coerce.date().nullable().default(null),
  sentAt: z.coerce.date().nullable().default(null),
  openedAt: z.coerce.date().nullable().default(null),
  repliedAt: z.coerce.date().nullable().default(null),
  bouncedAt: z.coerce.date().nullable().default(null),
  messageId: z.string().max(500).nullable().default(null),
  /** Set when a pending follow-up is cancelled (reply/bounce/terminal stage) — never sends. */
  cancelledAt: z.coerce.date().nullable().default(null),
});
export type ApplicationEmail = z.infer<typeof applicationEmailSchema>;

/** Application DTO as the API returns it (dates ISO-serialized). */
export interface ApplicationEmailResponse {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  kind: ApplicationEmailKind;
  scheduledAt: string | null;
  sentAt: string | null;
  openedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  messageId: string | null;
  cancelledAt: string | null;
}

export interface ApplicationResponse {
  id: string;
  jobPostId: string;
  hrEmail: string;
  hrName: string | null;
  company: string | null;
  role: string | null;
  stage: ApplicationStage;
  emails: ApplicationEmailResponse[];
  notes: string;
  createdAt: string;
}

/* ── Applications API (M4) ────────────────────────────────────────── */

/** Email tracking timestamps in response form (ISO strings). */
export const applicationEmailResponseSchema = z.object({
  subject: z.string(),
  bodyText: z.string(),
  bodyHtml: z.string(),
  kind: applicationEmailKindSchema,
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
  bouncedAt: z.string().nullable(),
  messageId: z.string().nullable(),
  cancelledAt: z.string().nullable(),
});

/** Tracking event kinds recorded on an application (SPEC §3 EmailEvent). */
export const emailEventKindSchema = z.enum(['open', 'bounce', 'reply']);
export type EmailEventKind = z.infer<typeof emailEventKindSchema>;

export const applicationEventSchema = z.object({
  kind: emailEventKindSchema,
  meta: z.record(z.unknown()),
  createdAt: z.string(),
});
export type ApplicationEventResponse = z.infer<typeof applicationEventSchema>;

/** Latest-email snapshot shown on Kanban cards. */
export const applicationLastEmailSchema = z.object({
  kind: applicationEmailKindSchema,
  sentAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
  bouncedAt: z.string().nullable(),
});
export type ApplicationLastEmail = z.infer<typeof applicationLastEmailSchema>;

/** GET /applications list item — lean DTO for the Kanban board. */
export const applicationSummarySchema = z.object({
  id: z.string(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  hrName: z.string().nullable(),
  hrEmail: z.string(),
  stage: applicationStageSchema,
  /** Whole days since the latest email was sent; null if none sent yet. */
  daysSinceSent: z.number().int().nullable(),
  lastEmail: applicationLastEmailSchema.nullable(),
  /**
   * Earliest pending follow-up send time (ISO); null when no follow-up is
   * scheduled — sequence stopped (reply/bounce/terminal stage) or none pending.
   */
  nextFollowUpAt: z.string().nullable(),
  /** Scheduled interview time (ISO) — set from the drawer (Phase 3). */
  interviewAt: z.string().nullable(),
  /** Free-form interview prep note shown alongside the reminder. */
  interviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type ApplicationSummary = z.infer<typeof applicationSummarySchema>;

/** GET /applications/:id — full thread + merged tracking-event timeline. */
export const applicationDetailSchema = z.object({
  id: z.string(),
  jobPostId: z.string(),
  hrEmail: z.string(),
  hrName: z.string().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  stage: applicationStageSchema,
  emails: z.array(applicationEmailResponseSchema),
  notes: z.string(),
  events: z.array(applicationEventSchema),
  /** Scheduled interview time (ISO) — set from the drawer (Phase 3). */
  interviewAt: z.string().nullable(),
  /** Free-form interview prep note shown alongside the reminder. */
  interviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type ApplicationDetailResponse = z.infer<typeof applicationDetailSchema>;

/**
 * PATCH /applications/:id body — stage, notes and/or interview fields (at
 * least one). interviewAt/interviewNote accept null so clearing works.
 */
export const applicationUpdateSchema = z
  .object({
    stage: applicationStageSchema.optional(),
    notes: z.string().max(5000).optional(),
    interviewAt: z.string().datetime({ offset: true }).nullable().optional(),
    interviewNote: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.stage !== undefined ||
      v.notes !== undefined ||
      v.interviewAt !== undefined ||
      v.interviewNote !== undefined,
    {
      message: 'Provide stage, notes, interviewAt and/or interviewNote',
    },
  );
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>;

export const applicationListResponseSchema = z.object({
  applications: z.array(applicationSummarySchema),
});
export type ApplicationListResponse = z.infer<typeof applicationListResponseSchema>;

export const applicationDetailResponseSchema = z.object({
  application: applicationDetailSchema,
});
export type ApplicationDetailEnvelope = z.infer<typeof applicationDetailResponseSchema>;

/** POST /applications/:id/mark-replied response — the updated application. */
export const markRepliedResponseSchema = z.object({
  application: applicationDetailSchema,
});
export type MarkRepliedResponse = z.infer<typeof markRepliedResponseSchema>;

/* ── Send flow (M3) ───────────────────────────────────────────────── */

/**
 * Machine-readable failure codes stored on JobPost.failureCode when the
 * send pipeline marks a job failed — the UI keys on these for inline fixes
 * (SPEC §9 edge cases 6/9/10).
 */
export const sendFailureCodeSchema = z.enum([
  'MX_INVALID_DOMAIN',
  'RESUME_MISSING',
  'GMAIL_NOT_CONNECTED',
  'EMAIL_NOT_VERIFIED',
  'SEND_FAILED',
]);
export type SendFailureCode = z.infer<typeof sendFailureCodeSchema>;

/** POST /jobs/:id/send body — empty object or an optional future send time. */
export const sendJobSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
});
export type SendJobInput = z.infer<typeof sendJobSchema>;

export interface SendJobResponse {
  queued: true;
  /** ISO timestamp the email is scheduled for (includes caps + jitter). */
  scheduledAt: string;
}

/* ── Gmail OAuth (M3) ─────────────────────────────────────────────── */

/** GET /gmail/connect response — SPA navigates the user to this URL. */
export interface GmailConnectResponse {
  url: string;
}

export interface GmailStatusResponse {
  connected: boolean;
  connectedEmail: string | null;
}
