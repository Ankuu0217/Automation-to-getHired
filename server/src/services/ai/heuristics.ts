import type { HrEmail, JobExtraction } from '@jobmail/shared';

/**
 * Pure regex/heuristic extraction from OCR text (SPEC §2 fallback chain).
 * No model involved — output quality is inherently lower, so confidence is
 * capped at ~0.45 regardless of how much was found.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const HR_LOCAL_RE = /^(careers|jobs|hr|recruiting|recruitment|talent|hiring|people)([._-]|@|$)/i;
const GENERIC_LOCAL_RE = /^(info|contact|hello|support|admin|mail)([._-]|@|$)/i;
const APPLY_CONTEXT_RE = /(contact|email|apply|reach out|send (your )?(resume|cv)|cv to|applications? to)/i;

function extractEmails(text: string, hrName: string | null): HrEmail[] {
  const found = text.match(EMAIL_RE) ?? [];
  const seen = new Set<string>();
  const emails: HrEmail[] = [];
  const nameTokens = (hrName ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2);

  for (const raw of found) {
    const email = raw.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);

    const local = email.split('@')[0];
    let confidence = 0.35;
    // HR-name proximity beats role-based mailboxes beats generic ones (SPEC §4A).
    if (nameTokens.some((t) => local.includes(t))) confidence += 0.4;
    else if (HR_LOCAL_RE.test(local)) confidence += 0.25;
    else if (GENERIC_LOCAL_RE.test(local)) confidence += 0.05;

    const idx = text.toLowerCase().indexOf(email);
    const window = text.slice(Math.max(0, idx - 150), idx + email.length + 150);
    if (APPLY_CONTEXT_RE.test(window)) confidence += 0.15;

    emails.push({ email, confidence: Math.min(0.95, confidence) });
  }
  return emails.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

function extractHrName(text: string): string | null {
  const m = text.match(
    /(?:posted by|recruiter|hiring manager|contact person|your contact)[:\s]+([A-Z][a-z]+(?: [A-Z][a-z]+){1,2})/,
  );
  return m ? m[1] : null;
}

function extractCompany(text: string): string | null {
  const patterns = [
    /([A-Z][A-Za-z0-9&.,' -]{1,50}?) is hiring/i,
    /([A-Z][A-Za-z0-9&.,' -]{1,50}?) is looking for/i,
    /[Jj]oin (?:the )?(?:team at )?([A-Z][A-Za-z0-9&.,' -]{1,50}?)(?:[.!\n,]| as )/,
    /[Aa]bout ([A-Z][A-Za-z0-9&.,' -]{1,50}?)\n/,
    /[Cc]ompany[:\s]+([A-Z][A-Za-z0-9&.,' -]{1,50}?)(?:\n|$)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const company = m[1].trim().replace(/[.,\s]+$/, '');
      if (company.length >= 2) return company;
    }
  }
  return null;
}

function extractRole(text: string): string | null {
  const patterns = [
    /hiring (?:a|an|the)?\s*([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\s*(?:in|at|[-–—|])|[.!\n])/,
    /looking for (?:a|an|the)?\s*([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\s*(?:in|at|to join|[-–—|])|[.!\n])/,
    /(?:role|position|title|job title)[:\s]+([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\n|$)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const role = m[1].trim().replace(/[.,\s]+$/, '');
      if (role.length >= 3) return role;
    }
  }
  return null;
}

function extractLocation(text: string): string | null {
  const m = text.match(/(?:location|📍|based in)[:\s]+([^\n]{2,60})/i);
  if (m) return m[1].trim().replace(/[.,\s]+$/, '');
  const remote = text.match(/\b(Remote|Hybrid|On-?site)\b/i);
  return remote ? remote[1] : null;
}

function cleanText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract structured job data from raw OCR text. Always returns a result
 * (never throws) — with nothing found it degrades to nulls + low confidence.
 */
export function extractFromText(text: string): { extraction: JobExtraction; rawText: string } {
  const rawText = cleanText(text);
  const hrName = extractHrName(rawText);
  const hrEmails = extractEmails(rawText, hrName);
  const company = extractCompany(rawText);
  const role = extractRole(rawText);
  const location = extractLocation(rawText);

  let confidence = 0.3;
  if (company) confidence += 0.05;
  if (role) confidence += 0.05;
  if (hrEmails.length > 0) confidence += 0.05;

  return {
    extraction: {
      company,
      role,
      location,
      jdText: rawText.slice(0, 20000),
      hrName,
      hrEmails,
      confidence,
    },
    rawText,
  };
}
