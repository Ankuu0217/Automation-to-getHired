import { SKILL_KEYWORDS } from '@jobmail/shared';
// pdf-parse v1's package entry has a debug-mode guard that breaks under ESM
// loaders (module.parent is undefined) — import the lib file directly.
// Types come from src/types/pdf-parse.d.ts.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?(\(?\d{3,5}\)?[-.\s]?)\d{3,4}[-.\s]?\d{4}/;

export interface ParsedResume {
  text: string;
  prefill: {
    skills: string[];
    summary: string;
    fullName: string | null;
    email: string | null;
    phone: string | null;
  };
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // pdf.js reads the raw ArrayBuffer and ignores byteOffset — Buffers returned
  // by fs.readFile are pool-backed with a non-zero offset, so hand pdf-parse
  // a dense copy with a zero offset or parsing fails with "bad XRef entry".
  const dense = new Uint8Array(buffer.byteLength);
  dense.set(buffer);
  const result = await pdfParse(dense as unknown as Buffer);
  return result.text.replace(/\s+\n/g, '\n').trim();
}

/** Case-insensitive, word-boundary-ish keyword match against resume text. */
export function matchSkills(text: string): string[] {
  const haystack = text.toLowerCase();
  return SKILL_KEYWORDS.filter((skill) => {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // C++ / C# etc. have no word boundary at the end — use lookaround instead.
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(haystack);
  });
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

/** Naive name guess: first non-empty line that looks like a person's name. */
export function guessFullName(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  for (const line of lines) {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || /https?:\/\//i.test(line)) continue;
    const words = line.split(/\s+/);
    const looksLikeName =
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Za-z][A-Za-z'’.-]*$/.test(w)) &&
      line.length <= 40;
    if (looksLikeName) return line;
  }
  return null;
}

export function parseResumeText(text: string): ParsedResume['prefill'] {
  return {
    skills: matchSkills(text),
    summary: buildSummary(text),
    fullName: guessFullName(text),
    email: text.match(EMAIL_RE)?.[0] ?? null,
    phone: text.match(PHONE_RE)?.[0] ?? null,
  };
}

export async function parseResumePdf(buffer: Buffer): Promise<ParsedResume> {
  const text = await extractTextFromPdf(buffer);
  return { text, prefill: parseResumeText(text) };
}
