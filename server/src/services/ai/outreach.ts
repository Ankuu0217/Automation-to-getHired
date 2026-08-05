import {
  SKILL_KEYWORDS,
  type EmailDraft,
  type JobMatch,
  type MatchAnalysisInput,
  type OutreachEmailInput,
} from '@jobmail/shared';
import { emailBodyToHtml, repairOutreachEmail } from '../emailRules';

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
  const angle = topSkill
    ? `${years ? `${years}+ years of` : 'Hands-on'} ${topSkill} experience that maps directly onto the ${role ?? 'role'} requirements`
    : `Broad, fast-ramping background suited to the ${role ?? 'role'} opening`;

  return { score, matchedSkills, gaps, angle };
}

/** Sign-off line + signature block (profile.signature wins when set). */
function closingBlock(input: OutreachEmailInput): string {
  const { profile, tone } = input;
  const signOff = tone === 'formal' ? 'Best regards,' : tone === 'friendly' ? 'Cheers,' : 'Thanks,';
  if (profile.signature.trim()) return `${signOff}\n${profile.signature.trim()}`;
  const lines = [profile.fullName || 'JobMail Autopilot user'];
  if (profile.phone) lines.push(profile.phone);
  if (profile.links.linkedin) lines.push(profile.links.linkedin);
  if (profile.links.portfolio) lines.push(profile.links.portfolio);
  return `${signOff}\n${lines.join('\n')}`;
}

/**
 * Template email honoring the hard rules: JD-specific hook, 2-3 proof
 * points, one soft CTA, signature block. Output is passed through
 * repairOutreachEmail so caps/banned-phrase rules hold even for odd inputs.
 * Note (M5): this deterministic fallback ignores `input.template` guidance —
 * template steering happens in the model prompt only; the fallback's own
 * fixed structure is already rule-compliant.
 */
export function generateEmailFromTemplate(input: OutreachEmailInput): EmailDraft {
  const { extraction, match, profile, tone } = input;
  const role = extraction.role ?? 'Software Engineer';
  const company = extraction.company ? ` at ${extraction.company}` : '';
  const firstName = extraction.hrName?.trim().split(/\s+/)[0];
  const greeting =
    tone === 'formal'
      ? `Dear ${extraction.hrName ?? 'Hiring Manager'},`
      : `Hi ${firstName ?? 'there'},`;

  const topSkills = match.matchedSkills.slice(0, 3);
  const years = profile.yearsExp;
  const yearsPhrase = years ? `${years}+ years of` : 'years of';

  const subject = topSkills[0]
    ? `Application: ${role}, ${years ? `${years} yrs ` : ''}${topSkills[0]}`
    : `Application: ${role}`;

  // Hook: reference something specific from the JD (the angle), never a pleasantry.
  const hook = topSkills.length > 0
    ? `Your ${role} opening${company} caught my eye — the emphasis on ${topSkills
        .slice(0, 2)
        .join(' and ')} matches what I build with every day.`
    : `Your ${role} opening${company} caught my eye — ${match.angle}.`;

  const proof: string[] = [];
  if (topSkills.length > 0) {
    proof.push(`- ${yearsPhrase} hands-on experience with ${topSkills.join(', ')}.`);
  }
  if (topSkills.length >= 2) {
    proof.push(
      `- Shipped production work across ${topSkills[0]} and ${topSkills[1]}, owning delivery end to end.`,
    );
  } else {
    proof.push('- Delivered projects end to end, from scoping through production rollout.');
  }
  proof.push('- Resume attached with full project details and impact numbers.');

  const cta =
    tone === 'friendly'
      ? 'Would you be up for a quick 15-minute call this week?'
      : 'Would you be open to a short 15-minute call this week?';

  const bodyText = [greeting, hook, proof.join('\n'), cta, closingBlock(input)].join('\n\n');

  return repairOutreachEmail({ subject, bodyText, bodyHtml: emailBodyToHtml(bodyText) });
}
