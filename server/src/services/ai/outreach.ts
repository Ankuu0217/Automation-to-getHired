import {
  SKILL_KEYWORDS,
  type EmailDraft,
  type JobMatch,
  type MatchAnalysisInput,
  type OutreachEmailInput,
} from '@jobmail/shared';
import { finalizeOutreachEmail, yearsPhrase } from './emailWriter';

/**
 * Deterministic match + email fallback (SPEC §2 fallback chain): used when
 * no AI API key is configured (OcrOnlyProvider) and when the model call
 * fails. No network involved — the output must be genuinely usable, so the
 * template honors every email hard rule and the result is still run through
 * repairOutreachEmail as a final guarantee.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Boundary-aware, case-insensitive skill match (handles Node.js, C++, C#). */
export function skillInText(skill: string, text: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(skill.toLowerCase())}($|[^a-z0-9+#])`, 'i');
  return re.test(text);
}

/**
 * Score jdText against the profile: skills the JD asks for vs skills the
 * candidate shows (profile.skills + summary + resume text). Score is the
 * percentage of JD skill keywords the candidate covers, plus a small bonus
 * when the role title matches their headline/preferred direction.
 */
export function analyzeMatchHeuristic(input: MatchAnalysisInput): JobMatch {
  const { jdText, role, profile } = input;
  const candidateText = [profile.skills.join(' '), profile.summary, profile.resumeText]
    .join('\n')
    .toLowerCase();

  const jdSkills = SKILL_KEYWORDS.filter((k) => skillInText(k, jdText));
  const matched = new Set<string>();

  for (const skill of jdSkills) {
    if (skillInText(skill, candidateText)) matched.add(skill);
  }
  // Profile skills the JD literally mentions count even off-list.
  for (const skill of profile.skills) {
    if (skill.length >= 2 && skillInText(skill, jdText)) matched.add(skill);
  }

  const matchedSkills = [...matched].slice(0, 10);
  const gaps = jdSkills.filter((k) => !matched.has(k)).slice(0, 5);

  let score: number;
  if (jdSkills.length > 0) {
    const covered = jdSkills.filter((k) => matched.has(k)).length;
    score = Math.round((100 * covered) / jdSkills.length);
  } else {
    // JD has no recognizable skill keywords — can't claim a strong match.
    score = matchedSkills.length > 0 ? 55 : 45;
  }
  if (role && skillInText(role, `${profile.headline} ${candidateText}`)) {
    score = Math.min(100, score + 10);
  }

  const topSkill = matchedSkills[0];
  const years = profile.yearsExp;
  const yp = yearsPhrase(years);
  const angle = topSkill
    ? `${yp ? `${yp} of` : 'Hands-on'} ${topSkill} experience that maps directly onto the ${role ?? 'role'} requirements`
    : `Broad, fast-ramping background suited to the ${role ?? 'role'} opening`;

  return { score, matchedSkills, gaps, angle };
}

/**
 * Deterministic, professional template email (used when every AI engine is
 * down). Structure mirrors what a strong candidate writes by hand: purpose →
 * background → 2 evidence bullets → attachment + ask. Finished by the same
 * pass as AI drafts (exact greeting + signature + hard rules).
 */
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

export function generateEmailFromTemplate(input: OutreachEmailInput): EmailDraft {
  const { extraction, match, profile } = input;
  const role = extraction.role ?? 'open';
  const company = extraction.company ?? 'your company';
  const yrs = yearsPhrase(profile.yearsExp);
  const skills = (match.matchedSkills.length ? match.matchedSkills : profile.skills).slice(0, 3);
  const cleanHeadline = profile.headline && !/[·|]|technical skills/i.test(profile.headline) ? profile.headline : '';

  const subject = `Application for ${role} - ${profile.fullName || 'Candidate'}`;

  const p1 = `I came across the ${role} opening at ${company} and would like to be considered for the role.`;
  const who = cleanHeadline ? `I am a ${cleanHeadline.replace(/^(a|an)\s+/i, '')}` : 'I am a developer';
  const p2 = skills.length
    ? `${who}${yrs ? ` with ${yrs} of experience` : ''}, working mainly with ${list(skills)}. The requirements in your post line up closely with the work I have been doing.`
    : `${who}${yrs ? ` with ${yrs} of experience` : ''}, and the requirements in your post line up closely with the work I have been doing.`;
  const bullets: string[] = [];
  if (skills.length) bullets.push(`- Hands-on experience with ${list(skills)}, the core of the stack in your post`);
  const firstFact = profile.summary.split(/(?<=[.!?])\s+/).find((x) => x.length > 30 && x.length < 170);
  bullets.push(`- ${firstFact ? firstFact.replace(/\.$/, '') : `${match.angle.charAt(0).toUpperCase()}${match.angle.slice(1).replace(/\.$/, '')}`}`);
  const close = `I have attached my resume for your reference. Would you be open to a short 15-minute call this week to discuss the role? Thank you for your time and consideration.`;

  const bodyText = ['Dear Hiring Team,', p1, p2, bullets.join('\n'), close].join('\n\n');
  return finalizeOutreachEmail({ subject, bodyText }, input);
}

