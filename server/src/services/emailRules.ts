import type { EmailDraft } from '@jobmail/shared';

/**
 * Outreach email hard rules (SPEC §4 Step C): plain professional English,
 * zero fluff, ≤ 180 words body, ≤ 7 words subject, banned stock phrases.
 * `validateOutreachEmail` reports violations; `repairOutreachEmail`
 * post-processes model output (strip banned phrases, enforce caps) before
 * a draft is persisted.
 */

export const MAX_BODY_WORDS = 180;
export const MAX_SUBJECT_WORDS = 7;

/** Stock phrases that make HR outreach sound templated (SPEC banned list + close variants). */
const BANNED_PHRASES: RegExp[] = [
  /i hope this (?:[\w-]+ )*finds you well/i,
  /i hope you are doing well/i,
  /i am writing to express my (keen |strong |sincere )?interest/i,
  /esteemed organi[sz]ation/i,
  /as per your requirements/i,
  /your (prestigious|reputed) (company|organization|organisation|firm)/i,
];

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function findBannedPhrases(text: string): string[] {
  return BANNED_PHRASES.filter((re) => re.test(text)).map((re) => re.source);
}

/**
 * Check a draft against the hard rules. Returns a list of human-readable
 * violations (empty = compliant).
 */
export function validateOutreachEmail(draft: Pick<EmailDraft, 'subject' | 'bodyText'>): string[] {
  const violations: string[] = [];
  const subjectWords = countWords(draft.subject);
  if (subjectWords > MAX_SUBJECT_WORDS) {
    violations.push(`Subject is ${subjectWords} words (max ${MAX_SUBJECT_WORDS})`);
  }
  if (draft.subject.trim().length === 0) violations.push('Subject is empty');
  if (/^job application$/i.test(draft.subject.trim())) {
    violations.push('Subject is too generic ("Job application")');
  }
  const bodyWords = countWords(draft.bodyText);
  if (bodyWords > MAX_BODY_WORDS) {
    violations.push(`Body is ${bodyWords} words (max ${MAX_BODY_WORDS})`);
  }
  for (const phrase of findBannedPhrases(draft.bodyText)) {
    violations.push(`Banned phrase in body: ${phrase}`);
  }
  for (const phrase of findBannedPhrases(draft.subject)) {
    violations.push(`Banned phrase in subject: ${phrase}`);
  }
  return violations;
}

function truncateWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(' ').replace(/[.,;:!?—-]+$/, '') + '…';
}

/** Remove sentences/lines containing banned phrases, preserving paragraph and bullet structure. */
function stripBannedPhrases(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Bullet lines stay atomic so <ul> rendering keeps working.
      if (line.trim().startsWith('- ')) {
        return BANNED_PHRASES.some((re) => re.test(line)) ? '' : line;
      }
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !BANNED_PHRASES.some((re) => re.test(s)))
        .join(' ');
    })
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert a plain-text body into simple semantic HTML: blank-line-separated
 * paragraphs become <p>, lines starting with "- " group into <ul><li>.
 * No images, no inline styles.
 */
export function emailBodyToHtml(bodyText: string): string {
  const blocks = bodyText.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => l.trim().startsWith('- '))) {
        const items = lines
          .map((l) => `    <li>${escapeHtml(l.trim().slice(2))}</li>`)
          .join('\n');
        return `  <ul>\n${items}\n  </ul>`;
      }
      return `  <p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

/**
 * Bring a draft back inside the hard rules: strip banned phrases from the
 * body, enforce subject/body word caps, rebuild the HTML from the repaired
 * text. Idempotent — a compliant draft passes through unchanged in meaning.
 */
export function repairOutreachEmail(draft: EmailDraft): EmailDraft {
  let subject = draft.subject.trim();
  if (/^job application$/i.test(subject)) subject = '';
  subject = truncateWords(subject, MAX_SUBJECT_WORDS);

  const bodyText = truncateWords(stripBannedPhrases(draft.bodyText), MAX_BODY_WORDS);

  return { subject, bodyText, bodyHtml: emailBodyToHtml(bodyText) };
}
