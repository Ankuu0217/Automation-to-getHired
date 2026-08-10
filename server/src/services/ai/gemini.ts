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
const EXTRACTION_PROMPT = `You extract structured hiring data from a screenshot of a LinkedIn hiring post or job listing. The screenshot is full of app UI — extract ONLY from the actual hiring post's content.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "company": "string|null",
  "role": "string|null",
  "location": "string|null",
  "jdText": "string (the hiring post's text, cleaned)",
  "hrName": "string|null",
  "hrEmails": [{ "email": "string", "confidence": 0.0-1.0 }],
  "confidence": 0.0-1.0
}

WHAT EACH FIELD MEANS:
- company: the organisation that is HIRING — from the post's wording (e.g. "We're hiring at X", "join <company>") or the author's company. It is NOT "LinkedIn", NOT any footer word, and NOT the name of the person who took the screenshot.
- role: the FULL job title exactly as written, e.g. "React Intern", "Senior Frontend Engineer", "Backend Developer (Node.js)". NEVER a bare keyword like "React" or "Backend".
- hrName: the person who WROTE the hiring post — the author name shown directly above the post text — i.e. the recruiter / hiring contact.
- hrEmails: every real email address written inside the post (e.g. "share your CV at name@company.com"). Score higher when the local-part matches the author's name, then role mailboxes (careers@, hr@, jobs@, talent@), then generic (info@, contact@).
- location: the job location if stated (city / "Remote" / "Hybrid"), else null.
- jdText: only the hiring post's own text, cleaned of UI.

STRICTLY IGNORE — this is app chrome and must NEVER become company/role/name:
- Top navigation, the search bar, "Home / My Network / Jobs / Messaging / Notifications".
- Side rails and ads: "See who's hiring on LinkedIn", "Try Premium", "People also viewed", "Promoted", "LinkedIn News", any banner image.
- The footer link row: "About · Accessibility · Help Center · Privacy & Terms · Advertising · Business Services · Get the app · LinkedIn Corporation © …". If you ever think the company is "Accessibility", "Help Center", "About", or "Privacy", you have picked footer chrome — discard it.
- Action bars and counts: "Like · Comment · Repost · Send", reaction/comment numbers, "…more", "Follow", "Connect".
- The VIEWER'S OWN profile card (the logged-in person taking the screenshot, often top-left) — that is neither the recruiter nor the company.

RULES:
- Never invent an email, name, company, or title. Use null when the post doesn't state it.
- confidence: 0.8+ only when the post states things plainly; 0.3–0.5 when the image is blurry/cropped and you are inferring; lower still if you had to guess the company or role.`;

/**
 * Strict JSON-output prompt for pasted-text extraction (Phase 2, POST
 * /jobs/import). Same output schema as the vision prompt — the parsing and
 * persistence pipeline downstream is shared.
 */
const TEXT_EXTRACTION_PROMPT = `You are extracting structured data from the pasted text of a job posting.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "company": "string|null",
  "role": "string|null",
  "location": "string|null",
  "jdText": "string (full cleaned job description text)",
  "hrName": "string|null (name of the poster/recruiter if mentioned)",
  "hrEmails": [{ "email": "string", "confidence": 0.0-1.0 }],
  "confidence": 0.0-1.0
}

Rules:
- company: the organisation hiring. role: the FULL job title as written (e.g. "React Intern"), never a bare keyword. hrName: the recruiter / hiring contact named in the post. location: city / Remote / Hybrid if stated.
- IGNORE page chrome the paste may have dragged along: navigation, cookie banners, "similar jobs", ads, footer links (About, Accessibility, Help Center, Privacy & Terms). Only real job content belongs in jdText.
- hrEmails: every email address present in the job content. Score confidence higher for emails tied to a named recruiter/hiring manager, then role-based mailboxes (careers@, jobs@, hr@, talent@), then generic ones (info@).
- If the text is truncated or noisy, still extract what you can and lower "confidence" accordingly.
- Use null for fields you genuinely cannot determine. Never invent emails, names, companies, or titles.`;

export interface GeminiExtractionResult {
  extraction: JobExtraction;
  /** Raw model text, kept for debugging/review in rawExtractedText. */
  rawText: string;
}

/**
 * Transient Gemini failures worth a retry: rate limits (429), server
 * overload/5xx, and network blips. Parse/schema errors are NOT transient —
 * they return false so we fail fast to the OCR/heuristic fallback.
 */
function isTransientGeminiError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|too many requests|rate.?limit|quota|resource.?exhausted|overloaded|unavailable|50[0234]|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network)\b/i.test(
    msg,
  );
}

/**
 * Run a Gemini call with exponential backoff on transient errors. Free-tier
 * per-minute limits and brief overloads are the common cause of "sometimes it
 * reads the screenshot, sometimes it doesn't" — a couple of spaced retries make
 * vision extraction succeed consistently instead of falling back to OCR.
 */
async function withGeminiRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !isTransientGeminiError(err)) break;
      const backoffMs = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
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

  const result = await withGeminiRetry(() =>
    model.generateContent([
      EXTRACTION_PROMPT,
      { inlineData: { data: buffer.toString('base64'), mimeType } },
    ]),
  );
  const text = result.response.text();

  return { extraction: parseExtractionJson(text), rawText: text };
}

/**
 * Send pasted job-post text to Gemini and parse the strict-JSON response.
 * Throws on API errors or unparseable output — the provider layer catches
 * and falls back to the regex heuristics.
 */
export async function extractTextWithGemini(rawText: string): Promise<GeminiExtractionResult> {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: env.GEMINI_MODEL });

  const result = await withGeminiRetry(() =>
    model.generateContent([
      TEXT_EXTRACTION_PROMPT,
      `JOB POSTING TEXT:\n${rawText.slice(0, 20000)}`,
    ]),
  );
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

  const result = await withGeminiRetry(() => model.generateContent(buildMatchPrompt(input)));
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
- Greet the recruiter by their first name when one is given above (else "Hi there,"). Name the exact role and company once, naturally.
- First line must reference something SPECIFIC from the job description (use the angle below). Never open with pleasantries.
- Structure: JD-specific hook → 2-3 concrete proof points mapped to the job's must-haves (use real numbers only if present in the profile) → one soft CTA (a 15-minute call, resume attached) → signature block.
- Tone: ${tone}.
- Do not invent achievements, companies, numbers, or skills not present in the candidate profile.

SOUND LIKE A REAL CANDIDATE, NOT AI (the recruiter must believe a genuine person wrote this):
- Write the way a competent engineer emails a recruiter: warm, direct, confident — not desperate, not gushing, not salesy.
- BANNED phrases (never use any): "I hope this finds you well", "I am writing to express my keen interest", "esteemed organization", "as per your requirements", "I am excited/thrilled/passionate to", "I believe I would be a great fit", "perfect fit", "I am confident that", "Furthermore", "Moreover", "In today's fast-paced world", "leverage my skills", "dynamic", "synergy", "a proven track record", any generic flattery.
- No exclamation marks. No em-dash pile-ups (at most one "—" in the whole email). No buzzword adjectives ("innovative", "cutting-edge", "world-class").
- Specificity beats adjectives: cite an actual tool, project, or outcome from the profile instead of "strong background". One human, specific detail that ties the candidate to THIS role is worth more than three generic claims.

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

  const result = await withGeminiRetry(() => model.generateContent(buildEmailPrompt(input)));
  const raw = result.response.text();
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in email generation response');

  const parsed = geminiDraftSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Email draft failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
