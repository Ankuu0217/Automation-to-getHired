import crypto from 'node:crypto';

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Dedupe key (SPEC §5): sha256 of userId + hrEmail + company + role,
 * normalized. Blocks double-applying to the same contact for the same job.
 */
export function computeDedupeHash(
  userId: string,
  hrEmail: string,
  company: string | null,
  role: string | null,
): string {
  const input = `${norm(userId)}|${norm(hrEmail)}|${norm(company)}|${norm(role)}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
