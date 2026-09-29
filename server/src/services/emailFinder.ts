import { env } from '../config/env';
import { hasMxRecord } from '../utils/emailValidation';
import { logger } from '../utils/logger';

/**
 * Recruiter email finder — for posts that name a recruiter/company but give no
 * address. Honest by design: without a paid verifier nobody can prove a
 * mailbox exists, so every suggestion carries a confidence and a source:
 *   - hunter:  Hunter.io (optional, HUNTER_API_KEY) — real published addresses;
 *   - pattern: the recruiter's name in the company's most common formats;
 *   - role:    shared hiring mailboxes (hr@, careers@ …).
 * Only domains with a real mail server (MX) are used.
 */

export interface EmailSuggestion {
  email: string;
  confidence: number;
  source: 'hunter' | 'pattern' | 'role';
  note: string;
}

const LEGAL_WORDS = /\b(technologies|technology|tech|pvt|private|ltd|limited|inc|llc|llp|corp|corporation|company|co|solutions|services|software|systems|labs|global|india|group|consulting|digital|infotech|the)\b/g;

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
}

/** Likely company domains from its name ("SISGAIN Technologies" → sisgain.com, sisgain.in …). */
export function domainCandidates(company: string): string[] {
  const clean = company.toLowerCase().replace(/[.,&()]/g, ' ');
  const core = slug(clean.replace(LEGAL_WORDS, ' '));
  const full = slug(clean);
  const bases = [...new Set([core, full].filter((b) => b.length >= 2))];
  const tlds = ['com', 'in', 'io', 'co', 'ai', 'co.in', 'tech'];
  return bases.flatMap((b) => tlds.map((t) => `${b}.${t}`));
}

export function namePatterns(fullName: string, domain: string): EmailSuggestion[] {
  const parts = fullName.toLowerCase().normalize('NFKD').replace(/[^a-z\s-]/g, '').split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  // Frequencies roughly follow published pattern studies: first.last leads
  // at mid/large companies, bare first name is common at startups.
  const pats: Array<[string, number]> = last
    ? [
        [`${first}.${last}`, 0.46],
        [`${first}`, 0.34],
        [`${first}${last}`, 0.28],
        [`${first[0]}${last}`, 0.24],
        [`${first}.${last[0]}`, 0.14],
        [`${first}_${last}`, 0.1],
      ]
    : [[first, 0.4]];
  return pats.map(([local, confidence]) => ({
    email: `${local}@${domain}`,
    confidence,
    source: 'pattern' as const,
    note: 'Common company format — not verified',
  }));
}

const ROLE_BOXES: Array<[string, number]> = [['hr', 0.3], ['careers', 0.3], ['jobs', 0.22], ['talent', 0.2], ['recruitment', 0.16]];

async function hunter(domain: string, fullName: string | null): Promise<EmailSuggestion[]> {
  if (!env.HUNTER_API_KEY) return [];
  const out: EmailSuggestion[] = [];
  try {
    if (fullName && fullName.trim().split(/\s+/).length >= 2) {
      const [first, ...rest] = fullName.trim().split(/\s+/);
      const u = new URL('https://api.hunter.io/v2/email-finder');
      u.search = new URLSearchParams({ domain, first_name: first, last_name: rest.join(' '), api_key: env.HUNTER_API_KEY }).toString();
      const r = await fetch(u, { signal: AbortSignal.timeout(8_000) });
      const b = (await r.json().catch(() => ({}))) as { data?: { email?: string; score?: number } };
      if (b.data?.email) out.push({ email: b.data.email.toLowerCase(), confidence: Math.min(0.97, (b.data.score ?? 70) / 100), source: 'hunter', note: 'Found by Hunter.io' });
    }
    const u2 = new URL('https://api.hunter.io/v2/domain-search');
    u2.search = new URLSearchParams({ domain, department: 'hr', limit: '5', api_key: env.HUNTER_API_KEY }).toString();
    const r2 = await fetch(u2, { signal: AbortSignal.timeout(8_000) });
    const b2 = (await r2.json().catch(() => ({}))) as { data?: { emails?: Array<{ value?: string; confidence?: number; position?: string | null }> } };
    for (const e of b2.data?.emails ?? []) {
      if (e.value) out.push({ email: e.value.toLowerCase(), confidence: Math.min(0.95, (e.confidence ?? 60) / 100), source: 'hunter', note: e.position ? `Hunter.io · ${e.position}` : 'Hunter.io · HR' });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), domain }, 'Hunter.io lookup failed');
  }
  return out;
}

export async function findRecruiterEmails(input: {
  company: string | null;
  hrName: string | null;
  domain?: string | null;
}): Promise<{ domains: string[]; suggestions: EmailSuggestion[] }> {
  const typed = input.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
  const candidates = typed ? [typed] : input.company ? domainCandidates(input.company) : [];
  const withMx: string[] = [];
  const checks = await Promise.all(candidates.slice(0, 14).map(async (d) => [d, await hasMxRecord(d).catch(() => false)] as const));
  for (const [d, ok] of checks) if (ok) withMx.push(d);
  const domains = withMx.slice(0, 2);

  const all: EmailSuggestion[] = [];
  for (const [i, domain] of domains.entries()) {
    const weight = i === 0 ? 1 : 0.7; // first-choice domain (e.g. .com) first
    all.push(...(await hunter(domain, input.hrName)));
    if (input.hrName) all.push(...namePatterns(input.hrName, domain).map((s) => ({ ...s, confidence: s.confidence * weight })));
    all.push(
      ...ROLE_BOXES.map(([box, c]) => ({
        email: `${box}@${domain}`,
        confidence: c * weight,
        source: 'role' as const,
        note: 'Shared hiring mailbox — often read by HR',
      })),
    );
  }
  const seen = new Set<string>();
  const suggestions = all
    .sort((a, b) => b.confidence - a.confidence)
    .filter((s) => (seen.has(s.email) ? false : (seen.add(s.email), true)))
    .slice(0, 8)
    .map((s) => ({ ...s, confidence: Math.round(s.confidence * 100) / 100 }));
  return { domains, suggestions };
}
