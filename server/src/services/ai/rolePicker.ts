import type { OutreachProfileSnapshot } from '@jobmail/shared';

/**
 * Multi-opening posts ("Senior Full Stack Developer | Full Stack Developer |
 * AI Engineer") — a candidate applies for ONE role, never "the X, Y, Z role".
 * Split the extracted role into openings and pick the one that best fits the
 * profile: title overlap with headline/preferred roles, skills mentioned in
 * that opening's section of the post, and experience band vs years.
 */

const ROLE_WORD = /\b(developer|engineer|intern|designer|analyst|manager|lead|architect|scientist|consultant|specialist|executive|associate|administrator|tester|qa|sde|devops|programmer)\b/i;

export function splitRoles(role: string | null | undefined): string[] {
  if (!role) return [];
  const parts = role
    .split(/\s*(?:\||;|\/\/|,(?![^()]*\))|\band\b|&)\s*/i)
    .map((p) => p.replace(/^(and|or)\s+/i, '').trim())
    .filter((p) => p.length > 1);
  // Only treat it as several openings when every part looks like a job title.
  if (parts.length > 1 && parts.every((p) => ROLE_WORD.test(p))) {
    return [...new Set(parts)];
  }
  return [role.trim()];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** The slice of the post that talks about one opening (from its title to the next opening's title). */
function sectionFor(jd: string, role: string, all: string[]): string {
  const lower = jd.toLowerCase();
  const start = lower.indexOf(role.toLowerCase());
  if (start < 0) return '';
  let end = lower.length;
  for (const other of all) {
    if (other === role) continue;
    const i = lower.indexOf(other.toLowerCase(), start + role.length);
    if (i > start && i < end) end = i;
  }
  return jd.slice(start, Math.min(end, start + 600));
}

function yearsBand(section: string): [number, number] | null {
  const m = section.match(/(\d+(?:\.\d+)?)\s*(?:[-–—to]+\s*(\d+(?:\.\d+)?))?\s*\+?\s*(?:years?|yrs?)/i);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo + 3;
  return [lo, hi];
}

export function pickBestRole(
  roles: string[],
  profile: Pick<OutreachProfileSnapshot, 'headline' | 'skills' | 'yearsExp' | 'summary'> & { preferredRoles?: string[] },
  jdText: string,
): string {
  if (roles.length <= 1) return roles[0] ?? '';
  const titleBag = new Set(words(`${profile.headline} ${(profile.preferredRoles ?? []).join(' ')} ${profile.summary.slice(0, 300)}`));
  const skills = profile.skills.map((s) => s.toLowerCase());
  const years = profile.yearsExp ?? 0;

  let best = roles[0];
  let bestScore = -Infinity;
  for (const role of roles) {
    const section = sectionFor(jdText, role, roles).toLowerCase();
    let score = 0;
    for (const w of words(role)) if (titleBag.has(w)) score += 2;
    for (const s of skills) if (s.length > 1 && section.includes(s)) score += 1.5;
    const band = yearsBand(section);
    if (band) {
      const [lo, hi] = band;
      if (years >= lo - 0.5 && years <= hi + 1) score += 3;
      else if (years < lo) score -= Math.min(6, (lo - years) * 2); // don't pitch a fresher for a senior role
    }
    if (/\bsenior|lead|principal|staff\b/i.test(role) && years < 3) score -= 3;
    if (/\bintern|trainee|fresher|junior\b/i.test(role) && years >= 2) score -= 2;
    if (score > bestScore) {
      bestScore = score;
      best = role;
    }
  }
  return best;
}
