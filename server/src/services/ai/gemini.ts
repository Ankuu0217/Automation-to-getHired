import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  matchAnalysisSchema,
  type JobExtraction,
  type JobMatch,
  type MatchAnalysisInput,
  type OutreachEmailInput,
} from '@jobmail/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { findFirstJsonObject, parseExtractionJson } from './parseExtraction';

/**
 * Strict JSON-output prompt for vision extraction (SPEC §4 Step A).
 */
const EXTRACTION_PROMPT = `You are extracting structured data from a screenshot of a LinkedIn job posting.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "company": "string|null",
  "role": "string|null",
  "location": "string|null",
  "jdText": "string (full cleaned job description text)",
  "hrName": "string|null (name of the poster/recruiter if visible)",
  "hrEmails": [{ "email": "string", "confidence": 0.0-1.0 }],
  "confidence": 0.0-1.0
}

Rules:
- IGNORE LinkedIn UI chrome: navigation, buttons, ads, "People also viewed", "Similar jobs", footer links, promotional banners. Only real job content belongs in jdText.
- hrEmails: every email address visible in the job content. Score confidence higher for emails tied to a named recruiter/hiring manager, then role-based mailboxes (careers@, jobs@, hr@), then generic ones (info@).
- If the screenshot is blurry or partially readable, still extract what you can and lower "confidence" accordingly.
- Use null for fields you genuinely cannot determine. Never invent emails or names.`;

export interface GeminiExtractionResult {
  extraction: JobExtraction;
  /** Raw model text, kept for debugging/review in rawExtractedText. */
  rawText: string;
}

/**
 * Send the screenshot to Gemini vision and parse the strict-JSON response.
 * Throws on API errors (quota, network) or unparseable output — the provider
 * layer catches and falls back to OCR.
 */
export async function extractWithGemini(
  buffer: Buffer,
  mimeType: string,
): Promise<GeminiExtractionResult> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const result = await model.generateContent([
    EXTRACTION_PROMPT,
    { inlineData: { data: buffer.toString('base64'), mimeType } },
  ]);
  const text = result.response.text();

  return { extraction: parseExtractionJson(text), rawText: text };
}

/* ── M3: match analysis + outreach email ────────────────────────── */

function buildMatchPrompt(input: MatchAnalysisInput): string {
  const { profile } = input;
  return `You are matching a job description against a candidate profile.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "score": 0-100 integer,
  "matchedSkills": ["skills the JD requires that the candidate demonstrably has"],
  "gaps": ["key JD requirements the candidate does not show evidence for"],
  "angle": "one sentence: the single strongest positioning hook for this candidate for this role"
}

Rules:
- Score honestly: 80+ only for near-perfect fits; below 40 means weak fit.
- matchedSkills/gaps: short skill names, max 10 / max 5 entries.
- Base judgments only on the evidence below. Never invent experience.

JOB DESCRIPTION (role: ${input.role ?? 'unknown'}, company: ${input.company ?? 'unknown'}):
${input.jdText.slice(0, 8000)}

CANDIDATE PROFILE:
Name: ${profile.fullName || 'unknown'}
Headline: ${profile.headline || 'n/a'}
Years of experience: ${profile.yearsExp ?? 'unknown'}
Skills: ${profile.skills.join(', ') || 'n/a'}
Summary: ${profile.summary || 'n/a'}
Resume text:
${profile.resumeText.slice(0, 8000) || 'n/a'}`;
}

/** Strict JSON-output match analysis. Throws on API errors or bad output — the provider falls back to heuristics. */
export async function analyzeMatchWithGemini(input: MatchAnalysisInput): Promise<JobMatch> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const result = await model.generateContent(buildMatchPrompt(input));
  const raw = result.response.text();
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in match analysis response');

  const parsed = matchAnalysisSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Match analysis failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

const geminiDraftSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  bodyText: z.string().trim().min(1).max(20000),
});

function buildEmailPrompt(input: OutreachEmailInput): string {
  const { extraction, match, profile, tone } = input;
  // M5: an EmailTemplate steers style/structure. Placeholders ({{hrName}},
  // {{role}}, {{company}}…) are adapted by the model, never substituted here.
  const templateSection = input.template
    ? `
OUTREACH TEMPLATE (use as style and structure guidance; adapt any {{placeholders}} to this job and candidate; every hard rule above still applies):
Template name: ${input.template.name}
Subject template: ${input.template.subjectTemplate}
Body template:
${input.template.bodyTemplate.slice(0, 4000)}
`
    : '';
  return `You are writing a cold outreach email from a job candidate to a recruiter.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "subject": "email subject line",
  "bodyText": "plain-text email body including greeting and signature"
}

HARD RULES (violations make the output unusable):
- Body: max 180 words, plain professional English, zero fluff.
- Subject: max 7 words, specific (e.g. "Application: Backend Engineer — 5 yrs Node/fintech"). Never just "Job application".
- First line must reference something SPECIFIC from the job description (use the angle below). Never open with pleasantries.
- NEVER use these phrases: "I hope this finds you well", "I am writing to express my keen interest", "esteemed organization", "as per your requirements", or any generic flattery.
- Structure: JD-specific hook → 2-3 quantified proof points mapped to the job's must-haves → one soft CTA (a 15-minute call, resume attached) → signature block.
- Tone: ${tone}.
- Do not invent achievements, companies, or numbers not present in the candidate profile.

JOB (company: ${extraction.company ?? 'unknown'}, role: ${extraction.role ?? 'unknown'}, recruiter: ${extraction.hrName ?? 'unknown'}):
${extraction.jdText.slice(0, 6000)}

MATCH ANALYSIS:
Score: ${match.score}/100
Matched skills: ${match.matchedSkills.join(', ') || 'none'}
Gaps: ${match.gaps.join(', ') || 'none'}
Angle: ${match.angle}

CANDIDATE:
Name: ${profile.fullName || 'unknown'}
Headline: ${profile.headline || 'n/a'}
Years of experience: ${profile.yearsExp ?? 'unknown'}
Skills: ${profile.skills.join(', ') || 'n/a'}
Summary: ${profile.summary || 'n/a'}
Phone: ${profile.phone || 'n/a'}
LinkedIn: ${profile.links.linkedin || 'n/a'}
Portfolio: ${profile.links.portfolio || 'n/a'}
Signature block (use verbatim if non-empty, otherwise compose from name/phone/LinkedIn/portfolio):
${profile.signature || 'n/a'}${templateSection}`;
}

/**
 * Strict JSON-output email generation. Returns { subject, bodyText } — the
 * caller builds bodyHtml and enforces the hard rules via repairOutreachEmail.
 * Throws on API errors or bad output — the provider falls back to the template.
 */
export async function generateEmailWithGemini(
  input: OutreachEmailInput,
): Promise<{ subject: string; bodyText: string }> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const result = await model.generateContent(buildEmailPrompt(input));
  const raw = result.response.text();
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in email generation response');

  const parsed = geminiDraftSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Email draft failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
