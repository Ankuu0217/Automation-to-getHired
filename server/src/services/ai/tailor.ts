import type { OutreachProfileSnapshot } from '@jobmail/shared';
import { SKILL_KEYWORDS } from '@jobmail/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { generateJsonWithGemini } from './gemini';
import { generateJsonOR, isOpenRouterConfigured } from './openrouter';
import { skillInText } from './outreach';

/**
 * Résumé tailoring for one job: a summary rewritten toward this posting,
 * résumé bullets re-phrased with the posting's vocabulary (facts unchanged),
 * and the posting's keywords the résumé is missing — so the candidate can
 * update the PDF before sending, and pass ATS keyword screens.
 */

export const tailoringSchema = z.object({
  summary: z.string().trim().min(20).max(700),
  highlights: z.array(z.string().trim().min(5).max(240)).max(5).catch([]),
  keywordsCovered: z.array(z.string().trim().min(1).max(60)).max(15).catch([]),
  keywordsMissing: z.array(z.string().trim().min(1).max(60)).max(10).catch([]),
});
export type Tailoring = z.infer<typeof tailoringSchema> & { source: 'ai' | 'basic' };

interface TailorInput {
  role: string | null;
  company: string | null;
  jdText: string;
  profile: OutreachProfileSnapshot;
}

function prompt({ role, company, jdText, profile }: TailorInput): string {
  return `You are a senior technical recruiter helping a candidate tailor their résumé to ONE job posting.

Return ONLY JSON:
{"summary": "...", "highlights": ["..."], "keywordsCovered": ["..."], "keywordsMissing": ["..."]}

- summary: a résumé "Professional Summary" rewritten for THIS job: 2-3 sentences, max 420 characters, no pronouns ("I", "my"), present tense. Lead with the title that matches the posting (${role ?? 'the role'}), years of experience if known, and the stack the posting asks for that the candidate really has. End with the kind of impact relevant to ${company ?? 'the company'}.
- highlights: 3-4 résumé bullet points re-written from the candidate's REAL experience using the posting's vocabulary. Start each with a strong past-tense verb. Keep every fact true; never add numbers, tools or employers that are not in the résumé.
- keywordsCovered: skills/tools from the posting that the résumé already shows (canonical spelling).
- keywordsMissing: important skills/tools from the posting that the résumé does NOT show — things worth adding only if the candidate truly has them.
- No clichés ("passionate", "results-driven", "team player", "hard-working").

JOB POSTING (${role ?? 'role'} at ${company ?? 'company'}):
${jdText.slice(0, 5000)}

CANDIDATE
Headline: ${profile.headline || 'n/a'}
Years: ${profile.yearsExp ?? 'n/a'}
Skills: ${profile.skills.join(', ') || 'n/a'}
Current summary: ${profile.summary || 'n/a'}
Résumé:
${profile.resumeText.slice(0, 7000) || 'n/a'}`;
}

/** No-AI fallback: keyword coverage + a summary assembled from the candidate's own facts. */
export function tailorBasic({ role, jdText, profile }: TailorInput): Tailoring {
  const candidate = `${profile.skills.join(' ')} ${profile.summary} ${profile.resumeText}`;
  const jdSkills = SKILL_KEYWORDS.filter((k) => skillInText(k, jdText));
  const covered = jdSkills.filter((k) => skillInText(k, candidate)).slice(0, 12);
  const missing = jdSkills.filter((k) => !skillInText(k, candidate)).slice(0, 8);
  const years = profile.yearsExp && profile.yearsExp >= 1 ? `${Math.floor(profile.yearsExp)}+ years of experience` : 'hands-on experience';
  const summary = `${role ?? profile.headline ?? 'Software developer'} with ${years} in ${covered.slice(0, 4).join(', ') || profile.skills.slice(0, 4).join(', ')}. ${profile.summary.split(/(?<=[.!?])\s+/)[0] ?? ''}`.trim();
  return { summary: summary.slice(0, 700), highlights: [], keywordsCovered: covered, keywordsMissing: missing, source: 'basic' };
}

export async function tailorResume(input: TailorInput): Promise<Tailoring> {
  const p = prompt(input);
  const parse = (v: unknown) => tailoringSchema.parse(v);
  const attempts: Array<() => Promise<z.infer<typeof tailoringSchema>>> = [];
  if (isOpenRouterConfigured()) attempts.push(() => generateJsonOR(p, parse, 'tailor'));
  if (env.GEMINI_API_KEY) attempts.push(async () => parse(await generateJsonWithGemini(p)));
  for (const run of attempts) {
    try {
      return { ...(await run()), source: 'ai' };
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Résumé tailoring engine failed');
    }
  }
  return tailorBasic(input);
}
