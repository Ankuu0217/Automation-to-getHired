import { z } from 'zod';
import { toneEnum } from './auth.js';

/* ── Email templates (SPEC §3 EmailTemplate, §6 /templates) ─────────────
 * Templates steer AI outreach generation (style/structure guidance) and
 * carry per-template funnel stats for A/B insight. `bodyTemplate` may use
 * {{hrName}} / {{firstName}} / {{role}} / {{company}} placeholders — they
 * are passed to the model as guidance, not substituted server-side.
 */

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const templateStatsSchema = z.object({
  sent: z.number().int().min(0),
  opened: z.number().int().min(0),
  replied: z.number().int().min(0),
});
export type TemplateStats = z.infer<typeof templateStatsSchema>;

/** POST /templates body. */
export const emailTemplateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  tone: toneEnum,
  subjectTemplate: z.string().trim().min(1, 'Subject template is required').max(300),
  bodyTemplate: z.string().trim().min(1, 'Body template is required').max(20000),
  isDefault: z.boolean().default(false),
});
export type EmailTemplateCreateInput = z.infer<typeof emailTemplateCreateSchema>;

/** PUT /templates/:id body — all fields optional, at least one required. */
export const emailTemplateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    tone: toneEnum.optional(),
    subjectTemplate: z.string().trim().min(1).max(300).optional(),
    bodyTemplate: z.string().trim().min(1).max(20000).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });
export type EmailTemplateUpdateInput = z.infer<typeof emailTemplateUpdateSchema>;

/** Template DTO as the API returns it. */
export const emailTemplateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  tone: toneEnum,
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  isDefault: z.boolean(),
  stats: templateStatsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailTemplateResponse = z.infer<typeof emailTemplateResponseSchema>;

export interface TemplateEnvelope {
  template: EmailTemplateResponse;
}

export interface TemplateListResponse {
  templates: EmailTemplateResponse[];
}

export interface TemplateDeletedResponse {
  deleted: true;
}

/**
 * Style/structure guidance handed to the AI provider when a template is
 * selected for a generation run (SPEC §4 Step C "template (or default)").
 */
export interface TemplateGuidance {
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

/** POST /jobs/:id/generate-email body — optionally pick a template. */
export const generateEmailSchema = z.object({
  templateId: objectIdString.optional(),
});
export type GenerateEmailInput = z.infer<typeof generateEmailSchema>;
