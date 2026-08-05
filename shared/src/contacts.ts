import { z } from 'zod';
import { applicationEmailKindSchema, applicationStageSchema } from './applications.js';

/* ── Recruiter contacts (Phase 4 mini-CRM) ────────────────────────
 * Derived entirely from Applications (+ their JobPosts) — there is no
 * Contact model. A "contact" is the recruiter email an application
 * actually targeted (Application.hrEmail, stamped at send time).
 */

/** One grouped recruiter row (GET /contacts). */
export const contactSchema = z.object({
  email: z.string(),
  /** Best-known recruiter name across their applications (null if never captured). */
  name: z.string().nullable(),
  companies: z.array(z.string()),
  roles: z.array(z.string()),
  /** Number of applications that targeted this address. */
  outreachCount: z.number().int().min(0),
  /** Latest sentAt across every email to this address (ISO); null if never sent. */
  lastContactedAt: z.string().nullable(),
  anyReplied: z.boolean(),
});
export type ContactResponse = z.infer<typeof contactSchema>;

export const contactsResponseSchema = z.object({
  contacts: z.array(contactSchema),
});
export type ContactsResponse = z.infer<typeof contactsResponseSchema>;

/** One email in the outreach history to a contact (GET /contacts/:email). */
export const contactEmailSchema = z.object({
  kind: applicationEmailKindSchema,
  sentAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
});
export type ContactEmailResponse = z.infer<typeof contactEmailSchema>;

/** One application in a contact's outreach history. */
export const contactApplicationSchema = z.object({
  id: z.string(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  stage: applicationStageSchema,
  emails: z.array(contactEmailSchema),
});
export type ContactApplicationResponse = z.infer<typeof contactApplicationSchema>;

export const contactDetailSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  applications: z.array(contactApplicationSchema),
});
export type ContactDetailResponse = z.infer<typeof contactDetailSchema>;

export const contactDetailResponseSchema = z.object({
  contact: contactDetailSchema,
});
export type ContactDetailEnvelope = z.infer<typeof contactDetailResponseSchema>;

/* ── Double-outreach guard (non-blocking) ───────────────────────── */

/** Window in which a prior send to the same address is flagged on the job DTO. */
export const RECENT_CONTACT_WINDOW_DAYS = 14;

/**
 * Informational flag on GET /jobs/:id: the job's chosen HR email was
 * contacted within the last RECENT_CONTACT_WINDOW_DAYS on a DIFFERENT
 * application. Never blocks sending.
 */
export interface RecentContactInfo {
  email: string;
  /** Whole days since the most recent send to this address. */
  daysAgo: number;
  /** Company of that most recent contact (null if unknown). */
  company: string | null;
}
