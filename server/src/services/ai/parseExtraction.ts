import { jobExtractionSchema, type HrEmail, type JobExtraction } from '@jobmail/shared';

/** Loose local email check for sanitizing model output before zod validation. */
const LOOSE_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function clamp01(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function asNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Extract the first balanced top-level {...} block from a string, respecting
 * string literals and escapes. Returns null when no balanced object exists.
 */
export function findFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function sanitizeEmails(raw: unknown): HrEmail[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HrEmail[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const email = (entry as Record<string, unknown>).email;
    if (typeof email !== 'string') continue;
    const normalized = email.trim().toLowerCase();
    if (!LOOSE_EMAIL_RE.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ email: normalized, confidence: clamp01((entry as Record<string, unknown>).confidence, 0.5) });
  }
  return out.slice(0, 10);
}

/**
 * Parse a raw vision-model response into a validated JobExtraction.
 * Tolerates markdown fences, prose before/after the JSON, and messy field
 * values (clamps confidences, drops invalid/duplicate emails). Throws on
 * unrecoverable garbage — callers fall back to OCR.
 */
export function parseExtractionJson(raw: string): JobExtraction {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Empty extraction response');
  }

  // Strip markdown code fences, then isolate the first balanced JSON object.
  const unfenced = raw.replace(/```(?:json)?/gi, ' ');
  const candidate = findFirstJsonObject(unfenced);
  if (!candidate) throw new Error('No JSON object found in extraction response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`Extraction response is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Extraction response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const sanitized = {
    company: asNullableString(obj.company),
    role: asNullableString(obj.role),
    location: asNullableString(obj.location),
    jdText: typeof obj.jdText === 'string' ? obj.jdText : '',
    hrName: asNullableString(obj.hrName),
    hrEmails: sanitizeEmails(obj.hrEmails),
    confidence: clamp01(obj.confidence, 0.5),
  };

  const result = jobExtractionSchema.safeParse(sanitized);
  if (!result.success) {
    throw new Error(`Extraction failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`);
  }
  return result.data;
}
