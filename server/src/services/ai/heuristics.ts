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

/**
 * LinkedIn / web UI chrome. A screenshot's OCR text drags in the nav, side ads,
 * action bar and the footer link row ("About · Accessibility · Help Center ·
 * Privacy & Terms · …") — the last of which the naive regex once read as the
 * company ("Accessibility Help Center"). We drop these before extracting.
 */
// A whole trimmed line that IS one chrome token (anchored, so real content like
// "Follow-up on incidents" is never dropped).
const CHROME_LINE_RE =
  /^(home|my network|jobs|messaging|notifications|try premium|premium|see who'?s hiring(?: on linkedin)?|people also viewed|promoted|linkedin news|about|accessibility|help center|privacy(?: & terms)?|terms(?: of service)?|advertising|business services|get the app|like|comment|repost|share|send|follow|connect|see more|show more|…?\s*more|\d[\d,]* (comments?|reposts?|likes?|reactions?|followers?|impressions?))$/i;
// Footer link soup that OCR often flattens onto one line.
const CHROME_INLINE_RE =
  /\b(accessibility\s+help\s+center|help\s+center|privacy\s*&?\s*terms|business\s+services|see who'?s hiring on linkedin|linkedin\s+corporation[^\n]*|© ?\d{4}[^\n]*)/gi;
// Words that can never be a real company/role — reject a match containing one.
const CHROME_WORD_RE =
  /\b(accessibility|help\s*center|privacy|terms|advertising|business services|linkedin|premium|messaging|notifications|newsletter)\b/i;

/** Strip UI chrome so the field extractors only see the hiring post's content. */
function stripChrome(text: string): string {
  return text
    .split('\n')
    .filter((l) => !CHROME_LINE_RE.test(l.trim()))
    .join('\n')
    .replace(CHROME_INLINE_RE, ' ');
}

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
      // Reject footer/nav words that slipped past chrome-stripping.
      if (company.length >= 2 && !CHROME_WORD_RE.test(company)) return company;
    }
  }
  return null;
}

function extractRole(text: string): string | null {
  const patterns = [
    // "in"/"at" terminators need word boundaries: "Platform" must not stop at "Pl".
    /hiring (?:a|an|the)?\s*([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\s+(?:in|at)\b|\s*[-–—|]|[.!\n])/,
    /looking for (?:a|an|the)?\s*([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\s+(?:in|at|to join)\b|\s*[-–—|]|[.!\n])/,
    /(?:role|position|title|job title)[:\s]+([A-Z][A-Za-z0-9+/# -]{2,60}?)(?:\n|$)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const role = m[1].trim().replace(/[.,\s]+$/, '');
      if (role.length >= 3 && !CHROME_WORD_RE.test(role)) return role;
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
  const rawText = cleanText(text); // original — kept for the "raw extracted text" panel
  const content = stripChrome(rawText); // chrome-free — what the field extractors see
  const hrName = extractHrName(content);
  const hrEmails = extractEmails(content, hrName);
  const company = extractCompany(content);
  const role = extractRole(content);
  const location = extractLocation(content);

  let confidence = 0.3;
  if (company) confidence += 0.05;
  if (role) confidence += 0.05;
  if (hrEmails.length > 0) confidence += 0.05;

  return {
    extraction: {
      company,
      role,
      location,
      jdText: content.slice(0, 20000),
      hrName,
      hrEmails,
      confidence,
    },
    rawText,
  };
}
