import { z } from 'zod';

const optionalUrl = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .or(z.literal(''))
  .optional();

export const profileUpdateSchema = z.object({
  fullName: z.string().trim().max(100).optional(),
  headline: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  location: z.string().trim().max(100).optional(),
  yearsExp: z.number().min(0).max(60).optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  links: z
    .object({
      linkedin: optionalUrl,
      github: optionalUrl,
      portfolio: optionalUrl,
    })
    .optional(),
  summary: z.string().trim().max(5000).optional(),
  /** Signature block appended to generated outreach emails (used in M3). */
  signature: z.string().trim().max(2000).optional(),
  preferredRoles: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  noticePeriod: z.string().trim().max(50).optional(),
  currentCTC: z.string().trim().max(50).optional(),
  expectedCTC: z.string().trim().max(50).optional(),
});
export type UpdateProfileInput = z.infer<typeof profileUpdateSchema>;

/** Metadata about the stored resume file (the path itself never leaves the server). */
export interface ResumeFileMeta {
  originalName: string;
  uploadedAt: string;
  parsedText: string;
}

/** Profile shape returned by GET/PUT /api/v1/profile. */
export interface ProfileResponse {
  fullName: string;
  headline: string;
  phone: string;
  location: string;
  yearsExp: number | null;
  skills: string[];
  links: { linkedin: string; github: string; portfolio: string };
  summary: string;
  signature: string;
  resumeFile: ResumeFileMeta | null;
  preferredRoles: string[];
  noticePeriod: string;
  currentCTC: string;
  expectedCTC: string;
}

/**
 * Everything we could read off a résumé, shaped like the profile form. Null /
 * empty means "not found" — the client only fills fields it has a value for.
 */
export interface ResumePrefill {
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  /** Years of professional experience (1 decimal), null when it can't be worked out. */
  yearsExp: number | null;
  skills: string[];
  /** Full https:// URLs; '' when the résumé has none. */
  links: { linkedin: string; github: string; portfolio: string };
  /** A short, professionally written summary (not the résumé's raw text). */
  summary: string;
  /** Roles the candidate is best placed to apply for. */
  preferredRoles: string[];
  /** 'ai' = read by Gemini; 'basic' = rule-based fallback (fewer/blunter fields). */
  source: 'ai' | 'basic';
}

/** Response of POST /api/v1/profile/resume — full profile + prefill suggestions. */
export interface ResumeParseResponse {
  profile: ProfileResponse;
  resumeFile: ResumeFileMeta;
  prefill: ResumePrefill;
}
