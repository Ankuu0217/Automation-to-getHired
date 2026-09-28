import type { ResumePrefill } from '@jobmail/shared';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { extractResumeWithGemini, type ResumeAiResult } from './ai/gemini';
import { extractPdfContent, looksGarbled } from './pdfContent';
import {
  extractEmail,
  extractLinks,
  extractPhone,
  matchSkills,
  parseResumeHeuristic,
  titleCaseName,
  guessFullName,
} from './resumeHeuristics';

/**
 * Résumé → profile prefill.
 *
 *   PDF ──► text + hyperlinks (pdfContent)
 *        ├─► Gemini (text, or the PDF itself when it is scanned/garbled) → structured fields
 *        └─► rule-based reader (resumeHeuristics) → same shape
 *
 * Gemini does the reading and writes the professional summary; the rules
 * verify the parts a model can get wrong (email, phone, URLs must literally
 * appear in the résumé; years of experience is cross-checked against the dated
 * Experience entries). Without Gemini — or when it fails — the rules alone
 * answer, so an upload never dead-ends.
 */

export interface ParsedResume {
  /** Plain text stored on the profile (used later for job matching and emails). */
  text: string;
  prefill: ResumePrefill;
}

// Re-exported for tests / callers that only need the pure helpers.
export { matchSkills, guessFullName, extractEmail, extractPhone, extractLinks };

/** Below this many characters the PDF has no usable text layer (scanned image). */
const MIN_TEXT_CHARS = 20;
/** Text shorter than this isn't enough to trust on its own — Gemini also gets the PDF. */
const TRUSTED_TEXT_CHARS = 120;

const MAX = { name: 100, headline: 100, location: 100, phone: 30, summary: 700, skill: 50, role: 80 } as const;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  return (await extractPdfContent(buffer)).text;
}

/** First ~500 chars of cleaned text, cut at a sentence/word boundary. */
export function buildSummary(text: string, maxLength = 500): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  const cut = cleaned.slice(0, maxLength);
  const lastPeriod = cut.lastIndexOf('. ');
  if (lastPeriod > maxLength * 0.5) return cut.slice(0, lastPeriod + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace)}…`;
}

/** Rule-based prefill from already-extracted text (no network, never throws). */
export function parseResumeText(text: string, urls: string[] = []): ResumePrefill {
  return parseResumeHeuristic(text, urls);
}

/* ── Merging Gemini's reading with the rule-based cross-checks ──── */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A model-supplied URL is only trusted if it (or its host/path) is really in the résumé. */
function verifiedUrl(candidate: string | null, evidence: string): string {
  if (!candidate) return '';
  const trimmed = candidate.trim().replace(/[),.;]+$/, '');
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/$/, '');
    if (!squash(evidence).includes(squash(host + path))) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function clampText(v: string | null | undefined, max: number): string | null {
  const t = v?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function cleanSummary(summary: string): string {
  let s = summary.replace(/\s+/g, ' ').trim();
  if (s.length > MAX.summary) {
    const cut = s.slice(0, MAX.summary);
    const last = cut.lastIndexOf('. ');
    s = last > MAX.summary * 0.5 ? cut.slice(0, last + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  return s;
}

function uniqueList(items: string[], max: number, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const k = v.toLowerCase();
    if (v.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function mergeAiPrefill(ai: ResumeAiResult, basic: ResumePrefill, text: string, urls: string[]): ResumePrefill {
  const evidence = `${text}\n${urls.join('\n')}`;

  // Years: trust dates when the rules could read them; otherwise the model.
  let yearsExp = ai.yearsExp ?? null;
  if (basic.yearsExp !== null && (yearsExp === null || Math.abs(yearsExp - basic.yearsExp) > 1)) {
    yearsExp = basic.yearsExp;
  }
  if (yearsExp !== null) yearsExp = Math.min(50, Math.max(0, Math.round(yearsExp * 10) / 10));

  const aiSkills = ai.skills.length ? ai.skills : [];
  // Keep AI skills that literally occur in the text (drops hallucinated ones) plus known-list hits.
  const haystack = squash(text);
  const groundedSkills = aiSkills.filter((s) => haystack.includes(squash(s)));
  const skills = uniqueList([...groundedSkills, ...basic.skills], 30, MAX.skill);

  const links = {
    linkedin: verifiedUrl(ai.links.linkedin, evidence) || basic.links.linkedin,
    github: verifiedUrl(ai.links.github, evidence) || basic.links.github,
    portfolio: verifiedUrl(ai.links.portfolio, evidence) || basic.links.portfolio,
  };

  const aiName = clampText(ai.fullName, MAX.name);
  const summary = cleanSummary(ai.summary) || basic.summary;

  return {
    fullName: aiName ? titleCaseName(aiName) : basic.fullName,
    headline: clampText(ai.headline, MAX.headline) ?? basic.headline,
    // Contact details come from the text itself, never from the model.
    email: basic.email,
    phone: basic.phone,
    location: clampText(ai.location, MAX.location) ?? basic.location,
    yearsExp,
    skills,
    links,
    summary,
    preferredRoles: uniqueList(ai.preferredRoles, 4, MAX.role),
    source: 'ai',
  };
}

/** Final safety net so nothing we hand to the profile form can exceed the profile schema. */
function clampPrefill(p: ResumePrefill): ResumePrefill {
  return {
    ...p,
    fullName: clampText(p.fullName, MAX.name),
    headline: clampText(p.headline, MAX.headline),
    phone: clampText(p.phone, MAX.phone),
    location: clampText(p.location, MAX.location),
    summary: cleanSummary(p.summary),
    skills: uniqueList(p.skills, 30, MAX.skill),
    preferredRoles: uniqueList(p.preferredRoles, 4, MAX.role),
  };
}

export class ResumeUnreadableError extends Error {
  constructor() {
    super(
      'We couldn’t read any text in this PDF — it looks like a scanned image. Export your résumé as a text PDF (from Word/Google Docs/Canva) and upload it again.',
    );
    this.name = 'ResumeUnreadableError';
  }
}

export async function parseResumePdf(buffer: Buffer): Promise<ParsedResume> {
  const { text: extracted, urls, geometricText } = await extractPdfContent(buffer);
  const hasText = extracted.length >= TRUSTED_TEXT_CHARS;
  const trustworthy = hasText && !looksGarbled(extracted);
  const aiEnabled = Boolean(env.GEMINI_API_KEY);

  let text = extracted;
  let ai: ResumeAiResult | null = null;

  if (aiEnabled) {
    try {
      // Gemini gets the PDF itself (so columns/graphics read correctly) plus the
      // extracted text when it is trustworthy (exact strings for names/links/dates).
      ai = await extractResumeWithGemini({ pdf: buffer, ...(trustworthy ? { text: extracted } : {}) });
      if (!trustworthy && ai.resumeText && ai.resumeText.trim().length >= TRUSTED_TEXT_CHARS) {
        text = ai.resumeText.trim();
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Gemini résumé parse failed — using rule-based reader',
      );
    }
  }

  if (text.length < MIN_TEXT_CHARS) throw new ResumeUnreadableError();

  const basic = parseResumeHeuristic(text, urls, new Date(), geometricText);
  const prefill = ai ? mergeAiPrefill(ai, basic, text, urls) : basic;
  return { text, prefill: clampPrefill(prefill) };
}
