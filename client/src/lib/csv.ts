import type { ApplicationSummary } from '@jobmail/shared';

/*
 * Client-side CSV export of the applications list (Phase 9).
 *
 * Column notes — ApplicationSummary is the lean list DTO and does NOT carry
 * the full email thread, only `lastEmail` (the latest SENT email) plus
 * `daysSinceSent`/`nextFollowUpAt`. Everything here is derived from that:
 * - "Sent date"  → lastEmail.sentAt as a YYYY-MM-DD date (empty when nothing
 *   has been sent yet), i.e. the date of the most recent send.
 * - "Opened" / "Replied" → the YYYY-MM-DD date of lastEmail.openedAt /
 *   lastEmail.repliedAt, empty when it hasn't happened.
 * - "Follow-ups" → derived from lastEmail.kind: emails[0] is always the
 *   initial and follow-ups append in order, so the kind of the latest sent
 *   email implies how many follow-ups have gone out (initial → 0,
 *   followup_1 → 1, followup_2 → 2). No per-application detail fetches.
 */

const HEADERS = [
  'Company',
  'Role',
  'Recruiter email',
  'Stage',
  'Sent date',
  'Opened',
  'Replied',
  'Follow-ups',
] as const;

const FOLLOWUPS_BY_KIND: Record<string, number> = {
  initial: 0,
  followup_1: 1,
  followup_2: 2,
};

/** ISO timestamp → YYYY-MM-DD, empty string for null. */
function isoDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

/**
 * RFC-4180 escaping + spreadsheet formula-injection neutralization: cells
 * starting with = + - @ get a leading single quote so Excel/Sheets treat
 * them as text; cells containing quotes, commas, or line breaks are wrapped
 * in double quotes with inner quotes doubled.
 */
export function escapeCsvCell(raw: string): string {
  let cell = raw;
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  if (/[",\r\n]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/** Builds the full CSV (CRLF line endings, header row first). */
export function buildApplicationsCsv(apps: ApplicationSummary[]): string {
  const rows = apps.map((app) => {
    const last = app.lastEmail;
    return [
      app.company ?? '',
      app.role ?? '',
      app.hrEmail,
      app.stage,
      isoDate(last?.sentAt ?? null),
      isoDate(last?.openedAt ?? null),
      isoDate(last?.repliedAt ?? null),
      String(last ? (FOLLOWUPS_BY_KIND[last.kind] ?? 0) : 0),
    ]
      .map(escapeCsvCell)
      .join(',');
  });
  return [HEADERS.join(','), ...rows].join('\r\n');
}

/** gethired-applications-YYYY-MM-DD.csv (local date). */
export function applicationsCsvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `gethired-applications-${y}-${m}-${d}.csv`;
}

/** Triggers a browser download of the CSV via a transient object URL. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
