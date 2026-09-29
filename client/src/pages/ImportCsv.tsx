import { MAX_CSV_ROWS, type ImportCsvResult } from '@jobmail/shared';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { Button, buttonVariants } from '@/components/ui/button';
import { ApiRequestError, generateJobEmail, importJobsCsv, sendJob } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import {
  applyMapping,
  autoMap,
  CSV_TEMPLATE,
  FIELD_LABEL,
  readCsv,
  REQUIRED_FIELDS,
  type ImportField,
  type Mapping,
} from '@/lib/csvImport';
import { RevealHeading, Stagger, StaggerItem } from '@/lib/motion';
import { cn } from '@/lib/utils';

/*
 * Spreadsheet import. The flow a recruiter-list owner actually needs:
 *   1. Drop a CSV (or download the template) — any column names, any separator.
 *   2. Check the auto-detected column mapping; invalid rows are flagged, not imported.
 *   3. Import → each valid row becomes an application ready for drafting
 *      (email + MX validated, duplicates skipped). No AI reading step needed.
 *   4. "Draft all emails" writes a personal email per row against your resume.
 *   5. Review any draft, then "Send all drafted" — the server still applies
 *      the hourly/daily caps and spacing, so a big list goes out safely.
 */

type RowState = 'imported' | 'drafting' | 'drafted' | 'sending' | 'queued' | 'error';

interface ImportedRow {
  jobId: string;
  company: string;
  role: string;
  hrEmail: string;
  state: RowState;
  note?: string;
}

const FIELDS = Object.keys(FIELD_LABEL) as ImportField[];

function errText(err: unknown, fallback: string) {
  return err instanceof ApiRequestError ? err.message : fallback;
}

export function ImportCsv() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [raw, setRaw] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [importing, setImporting] = useState(false);
  const [skipped, setSkipped] = useState<ImportCsvResult['skipped']>([]);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const onDrop = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    f.text().then((text) => {
      const parsed = readCsv(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        toast.error('That file has no data rows.');
        return;
      }
      setFileName(f.name);
      setHeaders(parsed.headers);
      setRaw(parsed.rows);
      setMapping(autoMap(parsed.headers, parsed.rows));
      setRows([]);
      setSkipped([]);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv', '.txt'], 'application/vnd.ms-excel': ['.csv'] },
  });

  const mapped = useMemo(() => applyMapping(raw, mapping), [raw, mapping]);
  const valid = mapped.filter((r) => r.problems.length === 0);
  const missingRequired = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);

  const doImport = async () => {
    setImporting(true);
    try {
      const res = await importJobsCsv(valid.slice(0, MAX_CSV_ROWS).map((r) => r.values));
      setRows(res.created.map((c) => ({ ...c, state: 'imported' as RowState })));
      setSkipped(res.skipped);
      toast.success(`${res.created.length} applications imported${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`);
    } catch (err) {
      toast.error(errText(err, 'Import failed.'));
    } finally {
      setImporting(false);
    }
  };

  const patch = (jobId: string, p: Partial<ImportedRow>) =>
    setRows((prev) => prev.map((r) => (r.jobId === jobId ? { ...r, ...p } : r)));

  const draftAll = async () => {
    setBusy('draft');
    for (const r of rows.filter((x) => x.state === 'imported' || x.state === 'error')) {
      patch(r.jobId, { state: 'drafting', note: undefined });
      try {
        await generateJobEmail(r.jobId);
        patch(r.jobId, { state: 'drafted' });
      } catch (err) {
        patch(r.jobId, { state: 'error', note: errText(err, 'Could not write the email') });
        if (err instanceof ApiRequestError && err.status === 429) {
          toast.error('Hourly drafting limit reached — continue in a little while.');
          break;
        }
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    setBusy(null);
  };

  const sendAll = async () => {
    setBusy('send');
    setConfirmSend(false);
    for (const r of rows.filter((x) => x.state === 'drafted')) {
      patch(r.jobId, { state: 'sending' });
      try {
        const res = await sendJob(r.jobId, {});
        const late = new Date(res.scheduledAt).getTime() - Date.now() > 60_000;
        patch(r.jobId, { state: 'queued', note: late ? `Scheduled ${new Date(res.scheduledAt).toLocaleString()}` : 'Sending now' });
      } catch (err) {
        patch(r.jobId, { state: 'error', note: errText(err, 'Could not queue') });
        if (err instanceof ApiRequestError && (err.code === 'GMAIL_NOT_CONNECTED' || err.code === 'EMAIL_NOT_VERIFIED')) break;
      }
    }
    setBusy(null);
    toast.success('Queued. Track them under Dispatches.');
  };

  const drafted = rows.filter((r) => r.state === 'drafted').length;
  const toDraft = rows.filter((r) => r.state === 'imported' || r.state === 'error').length;

  return (
    <Stagger className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Mono size="xs" color="fog">New dispatch · CSV</Mono>
          <RevealHeading as="h1" text="Import a list of openings." className="mt-1 font-sans text-heading font-normal text-paper" />
          <p className="mt-2 max-w-xl font-sans text-base text-text-2-dark">
            Have recruiter emails in a sheet? Import them here. Each row becomes an application — we
            write a personal email for each one against your resume, and you approve before anything is sent.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadCsv(CSV_TEMPLATE, 'gethired-import-template.csv')}>
          Download template
        </Button>
      </div>

      {rows.length === 0 && (
        <StaggerItem>
          <div
            {...getRootProps()}
            className={cn(
              'focus-ring flex cursor-pointer flex-col items-center gap-3 rounded-btn border border-dashed border-graphite bg-ink px-6 py-10 text-center transition-quick hover:border-lime',
              isDragActive && 'border-lime',
            )}
          >
            <input {...getInputProps()} aria-label="CSV file" />
            <FileSpreadsheet className="size-7 text-text-2-dark" />
            <p className="font-sans text-sm text-paper">
              {fileName ? `${fileName} · ${raw.length} rows — drop another to replace` : 'Drop a .csv file, or click to browse'}
            </p>
            <Mono size="xs" color="fog">
              Needs company, role and HR email columns · optional: HR name, location, description, link · up to {MAX_CSV_ROWS} rows
            </Mono>
          </div>
        </StaggerItem>
      )}

      {headers.length > 0 && rows.length === 0 && (
        <StaggerItem className="space-y-4 rounded-card border border-graphite bg-ink-2 p-5">
          <Mono size="xs" color="fog">Column mapping</Mono>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((f) => (
              <label key={f} className="block space-y-1" htmlFor={`map-${f}`}>
                <Mono size="xs" color={REQUIRED_FIELDS.includes(f) ? 'pure' : 'fog'}>
                  {FIELD_LABEL[f]}{REQUIRED_FIELDS.includes(f) ? ' *' : ''}
                </Mono>
                <select
                  id={`map-${f}`}
                  value={mapping[f] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))
                  }
                  className="focus-ring w-full rounded-btn border border-graphite bg-ink px-3 py-2 font-sans text-sm text-paper"
                >
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="overflow-x-auto rounded-btn border border-graphite">
            <table className="w-full min-w-[720px] text-left font-sans text-sm">
              <thead className="bg-ink">
                <tr>
                  {['Line', 'Company', 'Role', 'HR email', 'HR name', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-text-3-dark">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped.slice(0, 50).map((r) => (
                  <tr key={r.line} className="border-t border-graphite">
                    <td className="px-3 py-2 font-mono text-xs text-text-3-dark tabular-nums">{r.line}</td>
                    <td className="px-3 py-2 text-paper">{r.values.company}</td>
                    <td className="px-3 py-2 text-bone">{r.values.role}</td>
                    <td className="px-3 py-2 text-bone">{r.values.hrEmail}</td>
                    <td className="px-3 py-2 text-text-2-dark">{r.values.hrName}</td>
                    <td className="px-3 py-2">
                      {r.problems.length ? (
                        <Mono size="xs" color="danger">{r.problems.join(' · ')}</Mono>
                      ) : (
                        <Mono size="xs" color="cyan">Ready</Mono>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapped.length > 50 && <Mono size="xs" color="fog">Showing the first 50 of {mapped.length} rows.</Mono>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Mono size="xs" color={missingRequired.length ? 'warn' : 'fog'}>
              {missingRequired.length
                ? `Map ${missingRequired.map((f) => FIELD_LABEL[f]).join(', ')} to continue`
                : `${valid.length} ready · ${mapped.length - valid.length} will be skipped`}
            </Mono>
            <Button disabled={importing || missingRequired.length > 0 || valid.length === 0} onClick={() => void doImport()}>
              {importing && <Loader2 className="size-4 animate-spin" />}
              {importing ? 'Importing…' : `Import ${Math.min(valid.length, MAX_CSV_ROWS)} applications`}
            </Button>
          </div>
        </StaggerItem>
      )}

      {rows.length > 0 && (
        <StaggerItem className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-graphite bg-ink-2 p-4">
            <Mono size="xs" color="fog">
              {rows.length} imported · {drafted} drafted · {rows.filter((r) => r.state === 'queued').length} queued
              {skipped.length ? ` · ${skipped.length} skipped` : ''}
            </Mono>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy !== null || toDraft === 0} onClick={() => void draftAll()}>
                {busy === 'draft' && <Loader2 className="size-4 animate-spin" />}
                {busy === 'draft' ? 'Writing emails…' : `Draft ${toDraft} emails`}
              </Button>
              <Button size="sm" disabled={busy !== null || drafted === 0} onClick={() => setConfirmSend(true)}>
                Send {drafted} drafted…
              </Button>
            </div>
          </div>

          {confirmSend && (
            <div className="rounded-card border border-lime/40 bg-ink-2 p-4">
              <p className="font-sans text-sm text-paper">
                Send {drafted} emails from your Gmail? The first few go out right away; the rest are spaced
                out and held to your hourly and daily limits. Open any row to read or edit its draft first.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void sendAll()}>Yes, send {drafted}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <ul className="divide-y divide-graphite rounded-card border border-graphite bg-ink-2">
            {rows.map((r) => (
              <li key={r.jobId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-sans text-sm text-paper">{r.company} — {r.role}</p>
                  <p className="truncate font-sans text-xs text-text-2-dark">{r.hrEmail}{r.note ? ` · ${r.note}` : ''}</p>
                </div>
                <Mono size="xs" color={r.state === 'error' ? 'danger' : r.state === 'drafted' || r.state === 'queued' ? 'cyan' : 'fog'}>
                  {r.state === 'imported' ? 'Ready to draft' : r.state}
                </Mono>
                <Link to={`/apps/new?job=${r.jobId}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  {r.state === 'drafted' ? 'Review' : 'Open'}
                </Link>
              </li>
            ))}
          </ul>

          {skipped.length > 0 && (
            <div className="rounded-card border border-warn/40 bg-ink-2 p-4">
              <Mono size="xs" color="warn">Skipped rows</Mono>
              <ul className="mt-2 space-y-1">
                {skipped.map((s) => (
                  <li key={s.row} className="font-sans text-xs text-text-2-dark">Line {s.row}: {s.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </StaggerItem>
      )}
    </Stagger>
  );
}
