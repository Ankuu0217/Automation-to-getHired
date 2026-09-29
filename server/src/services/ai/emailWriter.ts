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
  formal:
    'Corporate-professional, the way a strong candidate writes to a recruiter at a large company: courteous, complete sentences, no slang, no contractions in the opening line.',
  friendly: 'Warm and personable but still professional. Contractions are fine. Reads like a thoughtful note, not a form letter.',
  confident: 'Crisp and self-assured. Short sentences, concrete claims, no hedging, no filler.',
};

const ROLE_MAILBOX = /^(hr|careers?|jobs?|talent|recruit(ing|ment|er)?|hiring|people|apply|resumes?|cv)[._-]?/i;

/** "Dear Riya," · "Dear SISGAIN Hiring Team," · "Dear Hiring Manager," */
export function greetingFor(input: Pick<OutreachEmailInput, 'extraction' | 'hrEmail' | 'tone'>): string {
  const name = input.extraction.hrName?.trim();
  const first = name && !/team|hr|hiring|recruit/i.test(name) ? name.split(/\s+/)[0] : null;
  const salutation = input.tone === 'formal' ? 'Dear' : 'Hi';
  if (first && first.length > 1) return `${salutation} ${first},`;
  const company = input.extraction.company?.trim();
  const local = input.hrEmail?.split('@')[0] ?? '';
  if (company && (ROLE_MAILBOX.test(local) || !first)) return `${salutation} ${company} Hiring Team,`;
  return `${salutation} Hiring Manager,`;
}

/** 0.2 → null (don't advertise it) · 1.5 → "1.5 years" · 3.2 → "3+ years" */
export function yearsPhrase(years: number | null | undefined): string | null {
  if (years == null || years < 0.9) return null;
  if (years < 2) return `${Math.round(years * 2) / 2} years`;
  return `${Math.floor(years)}+ years`;
}

export function buildEmailPrompt(input: OutreachEmailInput): string {
  const { extraction, match, profile, tone } = input;
  const greeting = greetingFor(input);
  const yrs = yearsPhrase(profile.yearsExp);
  const templateSection = input.template
    ? `
STYLE REFERENCE (the user's saved template — follow its structure and voice, adapt any {{placeholders}}; the rules above still win):
Subject: ${input.template.subjectTemplate}
${input.template.bodyTemplate.slice(0, 3000)}
`
    : '';
  const multi = input.allRoles && input.allRoles.length > 1
    ? `\nThe post lists several openings (${input.allRoles.join(' | ')}). The candidate is applying ONLY for "${extraction.role}". Name only that role; never list the others.`
    : '';

  return `You are ghost-writing a job application email that the candidate will send from their own Gmail to a recruiter. It must read exactly like a well-written email a real professional typed themselves: polished, specific, and human. A recruiter at a large company should find it credible and easy to act on.

Return ONLY JSON: {"subject": "...", "bodyText": "..."}

FORMAT (plain text; blank line between paragraphs):
${greeting}

Paragraph 1 (1-2 sentences): why you are writing. Name the exact role and company, and where you saw it if the post makes that clear. Example shape: "I came across your post for the Full Stack Developer position at Acme and would like to be considered for the role."

Paragraph 2 (2-3 sentences): who you are and the most relevant evidence. Current or most recent role, ${yrs ? `${yrs} of experience, ` : ''}core stack, and ONE concrete thing you built or delivered that matches what this post asks for.

Then 2-3 bullet lines starting with "- ": each maps a requirement from the post to real evidence from the resume (a project, tool, result). Keep each bullet to one line.

Closing paragraph (1-2 sentences): say the resume is attached, and ask for a conversation. A single courteous line such as "Thank you for your time and consideration." is fine.

Do NOT write a sign-off or signature (no "Best regards", no name, phone or links). The app appends the signature.

SUBJECT: 5-9 words, specific and professional. Format: "Application for <Role> - <Candidate Name>" or "<Role> - <Candidate Name> (<core stack>)". No emojis, no exclamation marks.

RULES
- Tone: ${tone}. ${TONE_GUIDE[tone] ?? ''}
- 110-170 words in the body. Short paragraphs.
- Use ONLY facts present in the candidate profile/resume below. Never invent employers, projects, numbers, degrees, years or skills. If the resume is thin, be brief rather than pad.
- Mention the company by name at least once.${multi}
- Plain, natural English. Vary sentence length. No buzzwords.
- NEVER use: "I hope this email finds you well", "I am writing to express my interest", "passionate", "thrilled", "excited", "keen interest", "esteemed", "leverage", "utilize", "synergy", "dynamic", "delve", "spearheaded", "proven track record", "perfect fit", "great fit", "I believe I would be", "cutting-edge", "world-class", "Furthermore", "Moreover", "Additionally". No exclamation marks. No em dashes (—).
- Never mention AI, this app, or that the email was generated.

JOB
Company: ${extraction.company ?? 'unknown'}
Role applied for: ${extraction.role ?? 'unknown'}
Location: ${extraction.location ?? 'n/a'}
Recruiter: ${extraction.hrName ?? 'unknown'}${input.hrEmail ? ` <${input.hrEmail}>` : ''}
Post:
${extraction.jdText.slice(0, 5000)}

FIT ANALYSIS
Strongest angle: ${match.angle}
Matching skills: ${match.matchedSkills.join(', ') || 'none found'}
Gaps (do not mention): ${match.gaps.join(', ') || 'none'}

CANDIDATE
Name: ${profile.fullName || 'unknown'}
Headline: ${profile.headline || 'n/a'}
Experience: ${yrs ?? 'early career / fresher'}
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
  /\bI am writing to express\b/i,
  /\bI('m| am) (so |very |truly )?(excited|thrilled|delighted|eager)\b/i,
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
  const signOff = tone === 'formal' ? 'Best regards,' : tone === 'friendly' ? 'Warm regards,' : 'Regards,';
  if (profile.signature.trim()) return `${signOff}\n${profile.signature.trim()}`;
  const clean = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const lines = [profile.fullName || ''];
  if (profile.headline && !/[·|]{2,}|technical skills/i.test(profile.headline) && profile.headline.length <= 70) lines.push(profile.headline);
  const contact = [profile.phone, profile.email].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  const links = [
    profile.links.linkedin && `LinkedIn: ${clean(profile.links.linkedin)}`,
    profile.links.github && `GitHub: ${clean(profile.links.github)}`,
    profile.links.portfolio && `Portfolio: ${clean(profile.links.portfolio)}`,
  ].filter(Boolean);
  if (links.length) lines.push(links.slice(0, 2).join(' | '));
  return `${signOff}\n${lines.filter(Boolean).join('\n')}`;
}

/**
 * Turn raw model output into the final draft: human tidy-up, exact signature,
 * then the hard-rule repair (caps, banned phrases, HTML).
 */
export function finalizeOutreachEmail(raw: RawEmailDraft, input: OutreachEmailInput): EmailDraft {
  let body = tidy(stripSignature(raw.bodyText, input.profile.fullName));
  // One consistent, correct salutation (e.g. "Dear SISGAIN Hiring Team," for hr@ mailboxes).
  body = body.replace(/^(dear|hi|hello|hey)\b[^\n]*\n/i, `${greetingFor(input)}\n`);
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
  if (input.allRoles && input.allRoles.length > 1) {
    const named = input.allRoles.filter((r) => raw.bodyText.toLowerCase().includes(r.toLowerCase()));
    if (named.length > 1 && named.some((r) => r !== input.extraction.role)) return 'lists several roles';
  }
  const company = input.extraction.company?.trim();
  if (company && company.length > 2 && !raw.bodyText.toLowerCase().includes(company.toLowerCase().split(/\s+/)[0])) {
    return 'does not mention the company';
  }
  return null;
}
