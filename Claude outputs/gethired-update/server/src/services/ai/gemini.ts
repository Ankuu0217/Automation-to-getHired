import { GoogleGenAI, type ContentListUnion } from '@google/genai';
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
import { buildEmailPrompt, emailDraftSchema } from './emailWriter';

/**
 * Strict JSON-output prompt for vision extraction (SPEC §4 Step A).
 */
export const EXTRACTION_PROMPT = `You extract structured hiring data from a screenshot of a LinkedIn hiring post or job listing. The screenshot is full of app UI — extract ONLY from the actual hiring post's content.

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
export const TEXT_EXTRACTION_PROMPT = `You are extracting structured data from the pasted text of a job posting.

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
/** A hung Gemini call would leave a job stuck in 'processing' forever. */
// 30 s × 3 attempts + backoff stays under the 120 s limit of a proxied request
// (Vercel → Render) for the synchronous generate-email call.
const GEMINI_TIMEOUT_MS = 30_000;
let genAIClient: GoogleGenAI | null = null;

/** Test hook: drop the cached client (e.g. after changing env in a test). */
export function resetGeminiClient(): void {
  genAIClient = null;
}

/**
 * Shared client (official @google/genai SDK) + JSON-mode generation.
 * `responseMimeType: application/json` makes Gemini emit bare JSON (no
 * ```fences/prose), so far fewer responses fail to parse and silently degrade
 * to the regex/template fallbacks. Returns the response text.
 */
function jsonModel(temperature?: number, kind: 'vision' | 'text' = 'text') {
  genAIClient ??= new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY!,
    httpOptions: { timeout: GEMINI_TIMEOUT_MS },
  });
  const client = genAIClient;
  return {
    async generate(contents: ContentListUnion): Promise<string> {
      const response = await client.models.generateContent({
        // Text-only calls may use a cheaper model (GEMINI_TEXT_MODEL, e.g. a Flash-Lite).
        model: kind === 'text' && env.GEMINI_TEXT_MODEL ? env.GEMINI_TEXT_MODEL : env.GEMINI_MODEL,
        contents,
        config: {
          responseMimeType: 'application/json',
          ...(temperature !== undefined ? { temperature } : {}),
        },
      });
      const text = response.text;
      if (!text) {
        const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason;
        throw new Error(`Gemini returned an empty response${reason ? ` (${reason})` : ''}`);
      }
      return text;
    },
  };
}

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
  const model = jsonModel(0.1, 'vision');

  const text = await withGeminiRetry(() =>
    model.generate([
      EXTRACTION_PROMPT,
      { inlineData: { data: buffer.toString('base64'), mimeType } },
    ]),
  );

  return { extraction: parseExtractionJson(text), rawText: text };
}

/**
 * Send pasted job-post text to Gemini and parse the strict-JSON response.
 * Throws on API errors or unparseable output — the provider layer catches
 * and falls back to the regex heuristics.
 */
export async function extractTextWithGemini(rawText: string): Promise<GeminiExtractionResult> {
  const model = jsonModel(0.1);

  const text = await withGeminiRetry(() =>
    model.generate([
      TEXT_EXTRACTION_PROMPT,
      `JOB POSTING TEXT:\n${rawText.slice(0, 20000)}`,
    ]),
  );

  return { extraction: parseExtractionJson(text), rawText: text };
}

/* ── M3: match analysis + outreach email ────────────────────────── */

export function buildMatchPrompt(input: MatchAnalysisInput): string {
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
  const model = jsonModel(0.2);

  const raw = await withGeminiRetry(() => model.generate(buildMatchPrompt(input)));
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in match analysis response');

  const parsed = matchAnalysisSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Match analysis failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

/**
 * Strict JSON-output email generation. Returns { subject, bodyText } — the
 * caller builds bodyHtml and enforces the hard rules via repairOutreachEmail.
 * Throws on API errors or bad output — the provider falls back to the template.
 */
export async function generateEmailWithGemini(
  input: OutreachEmailInput,
): Promise<{ subject: string; bodyText: string }> {
  const model = jsonModel(0.7);

  const raw = await withGeminiRetry(() => model.generate(buildEmailPrompt(input)));
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in email generation response');

  const parsed = emailDraftSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Email draft failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

/* ── Résumé → structured profile ────────────────────────────────── */

export const RESUME_PROMPT = (today: string, mode: 'text' | 'pdf' | 'both') => `You are an expert résumé parser and a senior technical recruiter who writes sharp candidate profiles. Read the résumé ${mode === 'pdf' ? '(the attached PDF; it may be scanned or multi-column)' : mode === 'both' ? '(the attached PDF, plus its extracted text; trust the PDF for layout/columns and the text for exact spellings)' : '(extracted text below; line breaks and column order can be imperfect)'} and return ONLY a JSON object matching this schema (no markdown, no prose):
{
  "fullName": "string|null",
  "headline": "string|null",
  "location": "string|null",
  "yearsExp": "number|null",
  "skills": ["string"],
  "links": { "linkedin": "string|null", "github": "string|null", "portfolio": "string|null" },
  "summary": "string",
  "preferredRoles": ["string"]${mode === 'pdf' ? ',\n  "resumeText": "string (complete plain-text transcription of the résumé)"' : ''}
}

TODAY is ${today} (use it for "Present"/"Current" end dates).

FIELD RULES
- fullName: the candidate's name as it appears at the top, in normal Title Case (never ALL CAPS). No titles or honorifics.
- headline: max 70 characters, the way a strong LinkedIn headline reads: the candidate's current or most recent job title plus 1-2 defining technologies, e.g. "Full Stack Developer (MERN)" or "Backend Engineer · Node.js · PostgreSQL". No company name. For a fresher/student with no jobs, use the role they are targeting or their strongest discipline, e.g. "Frontend Developer · React · TypeScript".
- location: "City, State" or "City, Country" for where the candidate is based (header/contact line, else current job). Not the college town unless nothing else exists. null if not stated.
- yearsExp: total years of professional work (jobs AND paid internships) computed from the employment date ranges. Overlapping periods count once. Do NOT count education, academic projects or gaps. Round to one decimal. 0 for a fresher with no work history. If there are no dates, use an explicit claim like "5+ years" only if the résumé states it, else null.
- skills: up to 30 real technical skills/tools/technologies/frameworks/methodologies actually present in the résumé, in canonical spelling ("Node.js", "PostgreSQL", "Tailwind CSS", "CI/CD"). Most important first. No soft skills, no duplicates, no generic words like "Programming".
- links: full URLs starting with https://. linkedin = LinkedIn profile, github = GitHub profile (username level, not a repo), portfolio = the candidate's personal website/portfolio. Use only URLs actually present in the résumé; null otherwise. Never invent or guess a URL.
- summary: THE MOST IMPORTANT FIELD. Write a polished professional summary of 2-4 sentences, max 430 characters, as a senior engineer would present a colleague: implied first person with NO "I", "my" or pronouns, present tense, concrete and specific. Sentence 1: role/seniority + years of experience + core stack. Sentence 2-3: what they have actually built or delivered (real projects, employers, domains, scale or metrics ONLY if written in the résumé). Freshers: lead with degree + strongest projects/internships. Absolutely no clichés or filler ("passionate", "hard-working", "results-driven", "team player", "seeking an opportunity", "highly motivated"). Never invent facts, employers, numbers or technologies. If the résumé already contains a summary/objective, rewrite it to this standard using only its facts. Do not copy contact details or raw résumé text.
- preferredRoles: 2-4 job titles this candidate should apply for, based on their evidence (e.g. "Full Stack Developer", "MERN Stack Developer", "Backend Developer").

If a field truly is not in the résumé use null (or [] / ""). Accuracy over completeness.`;

const nullableString = z
  .string()
  .nullish()
  .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null));

export const resumeAiSchema = z.object({
  fullName: nullableString,
  headline: nullableString,
  location: nullableString,
  yearsExp: z.preprocess((v) => (typeof v === 'string' ? Number.parseFloat(v) : v), z.number().nullish().catch(null)),
  skills: z.array(z.string()).catch([]),
  links: z
    .object({ linkedin: nullableString, github: nullableString, portfolio: nullableString })
    .catch({ linkedin: null, github: null, portfolio: null }),
  summary: z.string().catch(''),
  preferredRoles: z.array(z.string()).catch([]),
  resumeText: z.string().optional().catch(undefined),
});
export type ResumeAiResult = z.infer<typeof resumeAiSchema>;

/**
 * Read a résumé with Gemini and return structured profile fields. Pass the
 * extracted text when it is trustworthy, or the PDF itself for scanned /
 * garbled files (Gemini reads the pages directly and transcribes them).
 * Throws on API errors or unparseable output — the caller falls back to rules.
 */
export async function extractResumeWithGemini(
  input: { pdf?: Buffer; text?: string },
  today: Date = new Date(),
): Promise<ResumeAiResult> {
  if (!input.pdf && !input.text) throw new Error('extractResumeWithGemini needs a PDF or text');
  const hasPdf = Boolean(input.pdf);
  // Vision model when the PDF goes along, cheaper text model for text-only.
  const model = jsonModel(0.2, hasPdf ? 'vision' : 'text');
  const prompt = RESUME_PROMPT(today.toISOString().slice(0, 10), hasPdf ? (input.text ? 'both' : 'pdf') : 'text');

  const parts: ContentListUnion = [prompt];
  if (input.pdf) parts.push({ inlineData: { data: input.pdf.toString('base64'), mimeType: 'application/pdf' } });
  if (input.text) parts.push(`EXTRACTED TEXT (exact strings; reading order may be imperfect):\n${input.text.slice(0, 30000)}`);

  const raw = await withGeminiRetry(() => model.generate(parts), 2);
  const candidate = findFirstJsonObject(raw.replace(/```(?:json)?/gi, ' '));
  if (!candidate) throw new Error('No JSON object found in résumé parse response');
  const parsed = resumeAiSchema.safeParse(JSON.parse(candidate));
  if (!parsed.success) {
    throw new Error(`Résumé parse failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
