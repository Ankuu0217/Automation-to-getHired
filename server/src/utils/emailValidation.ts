import dns from 'node:dns';
import type { HrEmail } from '@jobmail/shared';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string' || email.length > 254) return false;
  return EMAIL_RE.test(email);
}

const ROLE_LOCAL_RE = /^(careers|jobs|hr|recruiting|recruitment|talent|hiring|people)([._-]|$)/i;
const GENERIC_LOCAL_RE = /^(info|contact|hello|support|admin|mail)([._-]|$)/i;

function rankBonus(email: string, hrName: string | null | undefined): number {
  const local = email.split('@')[0].toLowerCase();
  const nameTokens = (hrName ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2);
  // SPEC §4A ranking: HR-name match > role mailbox (careers@/hr@…) > generic (info@…).
  if (nameTokens.some((t) => local.includes(t))) return 0.5;
  if (ROLE_LOCAL_RE.test(local)) return 0.2;
  if (GENERIC_LOCAL_RE.test(local)) return 0.05;
  return 0;
}

/**
 * Pure ranking: sort by confidence + local-part bonus, descending.
 * Invalid and duplicate (case-insensitive) emails are dropped.
 */
export function rankEmails(emails: HrEmail[], hrName?: string | null): HrEmail[] {
  const seen = new Set<string>();
  const unique: HrEmail[] = [];
  for (const e of emails) {
    const normalized = e.email.trim().toLowerCase();
    if (!isValidEmail(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push({ email: normalized, confidence: Math.min(1, Math.max(0, e.confidence)) });
  }
  return unique.sort(
    (a, b) =>
      b.confidence + rankBonus(b.email, hrName) - (a.confidence + rankBonus(a.email, hrName)),
  );
}

const MX_TIMEOUT_MS = 3000;

/**
 * MX lookup with a hard timeout. Returns false on any DNS error/timeout.
 * Skipped (returns true) under NODE_ENV=test so tests never hit the network.
 */
export async function hasMxRecord(domain: string): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') return true;
  try {
    const records = await Promise.race([
      dns.promises.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MX lookup timeout')), MX_TIMEOUT_MS),
      ),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Full email pipeline (SPEC §4A): regex-validate, MX-check each distinct
 * domain, then rank. Emails on domains without MX records are dropped.
 */
export async function validateAndRankEmails(
  emails: HrEmail[],
  hrName?: string | null,
): Promise<HrEmail[]> {
  const ranked = rankEmails(emails, hrName);
  const domainCache = new Map<string, boolean>();
  const out: HrEmail[] = [];
  for (const e of ranked) {
    const domain = e.email.split('@')[1];
    let ok = domainCache.get(domain);
    if (ok === undefined) {
      ok = await hasMxRecord(domain);
      domainCache.set(domain, ok);
    }
    if (ok) out.push(e);
  }
  return out;
}
