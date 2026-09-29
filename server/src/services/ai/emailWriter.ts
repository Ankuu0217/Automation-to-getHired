import type { EmailDraft, OutreachEmailInput } from '@jobmail/shared';
import { z } from 'zod';
import { countWords, emailBodyToHtml, findBannedPhrases, repairOutreachEmail } from '../emailRules';

/**
 * Outreach email writing shared by every AI engine (OpenRouter, Gemini):
 * the prompt, the output schema, a quality gate that rejects robotic drafts
 * (so the engine chain can try the next model), and a deterministic finishing
 * pass that makes the email read like a real person typed it in Gmail.
 *
 * The model writes greeting → hook → proof → ask. The sign-off and signature
 * are appended here from the profile, so contact details are always exact and
 * never hallucinated.
 */

export const emailDraftSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  bodyText: z.string().trim().min(1).max(20000),
});
export type RawEmailDraft = z.infer<typeof emailDraftSchema>;

const TONE_GUIDE: Record<string, string> = {
  formal: 'Polite and professional, like a well-written note to a senior recruiter. No slang.',
  friendly: 'Warm and easy-going, like messaging a helpful stranger on LinkedIn. Still professional.',
  confident: 'Short and self-assured. States what the candidate has done plainly, no hedging, no padding.',
};

export function buildEmailPrompt(input: OutreachEmailInput): string {
  const { extraction, match, profile, tone } = input;
  const firstName = extraction.hrName?.trim().split(/\s+/)[0] ?? null;
  const templateSection = input.template
    ? `
STYLE REFERENCE (the user's saved template — follow its structure and voice, adapt any {{placeholders}}; the rules above still win):
Subject: ${input.template.subjectTemplate}
${input.template.bodyTemplate.slice(0, 3000)}
`
    : '';

  return `Write a short cold email from a job seeker to a recruiter. It must read like the candidate typed it themselves in Gmail: natural, specific, human. A recruiter should never suspect AI.

Return ONLY JSON: {"subject": "...", "bodyText": "..."}

WHAT GOOD LOOKS LIKE (structure and feel only; never copy the wording):
Subject: React Developer role - Aman Verma
Hi Riya,

Saw your post about the React Developer opening at Finlo. The part about rebuilding the merchant dashboard stood out, since I spent the last year on a similar rewrite at Paytrail, moving a legacy jQuery admin panel to React and TypeScript.

A couple of things that line up with what you listed:
- Built reusable components and charts that cut page load from 4s to about 1.5s
- Worked closely with the backend team on REST APIs in Node.js

I've attached my resume. Would you be open to a quick chat this week?

RULES
1. Greeting: "Hi ${firstName ?? 'there'}," ${firstName ? '' : '(no recruiter name is known)'}. Nothing before it.
2. Opening (1-2 sentences): mention something SPECIFIC from this job post (a product, a requirement, the team) and connect it to one real thing the candidate did. Never open with who you are or with pleasantries.
3. Proof: 2-3 short bullet lines ("- ") OR 2 short sentences, each tied to a requirement in the job post, using ONLY facts from the candidate profile below. Numbers only if they appear in the profile.
4. Close with ONE simple ask in one line: mention the resume is attached and ask for a short call or next step.
5. STOP after the ask. Do NOT write a sign-off, name, phone, or links. The app adds the signature.
6. Length: 70-130 words for the body. Short paragraphs (1-3 lines each).
7. Subject: 4-7 words, plain, like a person would write: role + name or role + one strength. Example: "Backend Developer role - Priya Nair" or "Node.js developer for your backend opening". No emojis, no colons-heavy marketing, no "Application for the post of".
8. Tone: ${tone}. ${TONE_GUIDE[tone] ?? ''}
9. Write simple, everyday English. Contractions are fine (I've, I'd). Vary sentence length.
10. NEVER use: "I hope this email finds you well", "I am writing to", "I am excited/thrilled", "passionate", "keen interest", "esteemed", "leverage", "utilize", "synergy", "dynamic", "delve", "spearheaded", "proven track record", "perfect fit", "great fit", "I believe I would", "I am confident", "Furthermore", "Moreover", "Additionally", "In today's", "cutting-edge", "innovative", "world-class", "reach out", "look forward to hearing from you". No exclamation marks. No em dashes (—); use commas or full stops.
11. Never invent employers, projects, numbers, degrees or skills. If the profile is thin, keep it short rather than padding.

JOB
Company: ${extraction.company ?? 'unknown'}
Role: ${extraction.role ?? 'unknown'}
Location: ${extraction.location ?? 'n/a'}
Recruiter: ${extraction.hrName ?? 'unknown'}
Post:
${extraction.jdText.slice(0, 5000)}

WHY THE CANDIDATE FITS (from our analysis)
Strongest angle: ${match.angle}
Matching skills: ${match.matchedSkills.join(', ') || 'none found'}

CANDIDATE
Name: ${profile.fullName || 'unknown'}
Headline: ${profile.headline || 'n/a'}
Experience: ${profile.yearsExp != null ? `${profile.yearsExp} years` : 'n/a'}
Skills: ${profile.skills.slice(0, 25).join(', ') || 'n/a'}
Summary: ${profile.summary || 'n/a'}
Resume (source of truth for facts):
${profile.resumeText.slice(0, 6000) || 'n/a'}${templateSection}`;
}

/* ── Finishing pass ──────────────────────────────────────────────── */

/** Word swaps that turn "AI voice" into plain speech. */
const PLAIN_WORDS: Array<[RegExp, string]> = [
  [/\butili[sz]ing\b/gi, 'using'],
  [/\butili[sz](e|es|ed)\b/gi, 'us$1'],
  [/\bleverag(e|es|ed|ing)\b/gi, 'us$1'],
  [/\bspearhead(ed|ing)?\b/gi, 'led'],
  [/\bendeavou?r\b/gi, 'effort'],
  [/\bcommence(d)?\b/gi, 'start$1'],
  [/\bfacilitate(d)?\b/gi, 'help$1'],
];

/** Whole sentences that add nothing and scream template — dropped outright. */
const FILLER_SENTENCES: RegExp[] = [
  /\bI hope (this|you)\b/i,
  /\bI am writing (to|this)\b/i,
  /\bI('m| am) (so |very |truly )?(excited|thrilled|delighted|eager)\b/i,
  /\blook(ing)? forward to hearing\b/i,
  /\bthank you for (your )?(time|consideration)\b/i,
  /\bplease (do not|don't) hesitate\b/i,
  /\bI believe I (would|could|will) be\b/i,
];

const SIGN_OFF_LINE = /^(best|best regards|regards|kind regards|warm regards|thanks|thank you|cheers|sincerely|yours sincerely|many thanks)[,!.]?$/i;

/** Strip any sign-off/signature the model added anyway (everything from a sign-off line down). */
function stripSignature(body: string, fullName: string): string {
  const lines = body.split('\n');
  for (let i = Math.max(1, lines.length - 8); i < lines.length; i++) {
    const l = lines[i].trim();
    if (SIGN_OFF_LINE.test(l) || (fullName && l.toLowerCase() === fullName.toLowerCase())) {
      return lines.slice(0, i).join('\n').trimEnd();
    }
  }
  return body.trimEnd();
}

function tidy(body: string): string {
  let out = body
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2') // number/date ranges keep a hyphen
    .replace(/\s*[—–]\s*/g, ', ') // em/en dash → comma (the #1 AI tell)
    .replace(/!/g, '.')
    .replace(/^\s*[•*·]\s+/gm, '- ');
  for (const [re, rep] of PLAIN_WORDS) out = out.replace(re, rep);
  out = out.replace(/^(Furthermore|Moreover|Additionally|In addition),\s*(\w)/gm, (_m, _w, c: string) => c.toUpperCase());
  out = out
    .split('\n')
    .map((line) =>
      line.trim().startsWith('- ')
        ? line
        : line
            .split(/(?<=[.?])\s+/)
            .filter((s) => !FILLER_SENTENCES.some((re) => re.test(s)))
            .join(' '),
    )
    .join('\n');
  return out
    .replace(/,\s*,/g, ',')
    .replace(/\.{2,}/g, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function signature(input: OutreachEmailInput): string {
  const { profile, tone } = input;
  const signOff = tone === 'formal' ? 'Best regards,' : 'Thanks,';
  if (profile.signature.trim()) return `${signOff}\n${profile.signature.trim()}`;
  const lines = [profile.fullName || ''];
  if (profile.phone) lines.push(profile.phone);
  const link = profile.links.linkedin || profile.links.portfolio || profile.links.github;
  if (link) lines.push(link.replace(/^https?:\/\/(www\.)?/, ''));
  return `${signOff}\n${lines.filter(Boolean).join('\n')}`;
}

/**
 * Turn raw model output into the final draft: human tidy-up, exact signature,
 * then the hard-rule repair (caps, banned phrases, HTML).
 */
export function finalizeOutreachEmail(raw: RawEmailDraft, input: OutreachEmailInput): EmailDraft {
  const body = tidy(stripSignature(raw.bodyText, input.profile.fullName));
  const subject = raw.subject
    .replace(/^subject:\s*/i, '')
    .replace(/[—–]/g, '-')
    .replace(/!/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  const bodyText = `${body}\n\n${signature(input)}`.trim();
  const repaired = repairOutreachEmail({ subject, bodyText, bodyHtml: '' });
  return { ...repaired, bodyHtml: emailBodyToHtml(repaired.bodyText) };
}

/**
 * Quality gate for a model's draft. Returns a reason when the draft is not
 * good enough to show (the engine chain then tries the next model), or null.
 */
export function draftQualityProblem(raw: RawEmailDraft, input: OutreachEmailInput): string | null {
  const words = countWords(raw.bodyText);
  if (words < 35) return `too short (${words} words)`;
  if (words > 240) return `too long (${words} words)`;
  if (findBannedPhrases(raw.bodyText).length > 1) return 'template phrases';
  if (/\[(your|company|name|role)[^\]]*\]|\{\{/i.test(`${raw.subject} ${raw.bodyText}`)) return 'unfilled placeholders';
  if (!/^(hi|hello|dear|hey)\b/i.test(raw.bodyText.trim())) return 'no greeting';
  const company = input.extraction.company?.trim();
  if (company && company.length > 2 && !raw.bodyText.toLowerCase().includes(company.toLowerCase().split(/\s+/)[0])) {
    return 'does not mention the company';
  }
  return null;
}
