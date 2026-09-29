/**
 * CSV → application rows. RFC 4180 parsing (quoted fields, escaped quotes,
 * commas/newlines inside quotes, CRLF, BOM), then header auto-mapping onto our
 * fields so exports from Google Sheets, Excel, Notion or a job tracker work
 * without renaming columns.
 */

export type ImportField = 'company' | 'role' | 'hrEmail' | 'hrName' | 'location' | 'jdText' | 'sourceUrl';

export const FIELD_LABEL: Record<ImportField, string> = {
  company: 'Company',
  role: 'Role',
  hrEmail: 'HR email',
  hrName: 'HR name',
  location: 'Location',
  jdText: 'Job description / notes',
  sourceUrl: 'Job link',
};

export const REQUIRED_FIELDS: ImportField[] = ['company', 'role', 'hrEmail'];

const SYNONYMS: Record<ImportField, RegExp> = {
  company: /^(company|company name|organi[sz]ation|employer|firm|org)$/,
  role: /^(role|job title|title|position|job|designation|opening|job role)$/,
  hrEmail: /^(hr email|email|e-mail|recruiter email|contact email|mail|email id|hr mail|contact|recruiter e-mail)$/,
  hrName: /^(hr name|hr|recruiter|recruiter name|contact name|name|hiring manager|poc|contact person)$/,
  location: /^(location|city|place|job location|office)$/,
  jdText: /^(description|job description|jd|notes|details|requirements|about|summary|skills)$/,
  sourceUrl: /^(link|url|job link|job url|source|source url|posting|post link|linkedin)$/,
};

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      // Accept comma, semicolon (European Excel) and tab separators — but only
      // the one the header row uses (decided below by detectDelimiter).
      if (c === DELIM) {
        row.push(cell);
        cell = '';
      } else cell += c;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

let DELIM = ',';
function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function readCsv(text: string): { headers: string[]; rows: string[][] } {
  DELIM = detectDelimiter(text);
  const all = parseCsv(text);
  const [headers = [], ...rows] = all;
  return { headers, rows };
}

export type Mapping = Partial<Record<ImportField, number>>;

const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();

/** Header index for each field, by synonym; falls back to sniffing an email-looking column. */
export function autoMap(headers: string[], sample: string[][] = []): Mapping {
  const map: Mapping = {};
  const used = new Set<number>();
  const order: ImportField[] = ['hrEmail', 'company', 'role', 'hrName', 'location', 'jdText', 'sourceUrl'];
  for (const field of order) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && SYNONYMS[field].test(norm(h)));
    if (i >= 0) {
      map[field] = i;
      used.add(i);
    }
  }
  if (map.hrEmail === undefined && sample.length) {
    const i = headers.findIndex((_, idx) => !used.has(idx) && sample.slice(0, 5).some((r) => /\S+@\S+\.\S+/.test(r[idx] ?? '')));
    if (i >= 0) map.hrEmail = i;
  }
  return map;
}

export interface MappedRow {
  line: number;
  values: Record<ImportField, string>;
  problems: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function applyMapping(rows: string[][], map: Mapping): MappedRow[] {
  return rows.map((r, i) => {
    const values = {} as Record<ImportField, string>;
    for (const f of Object.keys(FIELD_LABEL) as ImportField[]) {
      const idx = map[f];
      values[f] = idx === undefined ? '' : (r[idx] ?? '').trim();
    }
    // "Priya <priya@x.com>" or "mailto:" cells → the bare address.
    const m = values.hrEmail.match(/[^\s<>:;,]+@[^\s<>:;,]+/);
    values.hrEmail = (m?.[0] ?? values.hrEmail).toLowerCase();
    const problems: string[] = [];
    for (const f of REQUIRED_FIELDS) if (!values[f]) problems.push(`${FIELD_LABEL[f]} missing`);
    if (values.hrEmail && !EMAIL.test(values.hrEmail)) problems.push('Invalid email');
    return { line: i + 2, values, problems };
  });
}

export const CSV_TEMPLATE =
  'company,role,hr_email,hr_name,location,job_description,job_link\n' +
  'Finlo,Frontend Developer,riya.shah@finlo.io,Riya Shah,Bengaluru,"React, TypeScript, REST APIs. 1-3 years.",https://www.linkedin.com/jobs/view/123\n' +
  'SISGAIN Technologies,Full Stack Developer,hr@sisgain.com,,Noida,"React | Node.js | PostgreSQL | MongoDB. 1-2 years.",\n';
