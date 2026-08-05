import type { ApplicationSummary } from '@jobmail/shared';
import { describe, expect, it } from 'vitest';

import { applicationsCsvFilename, buildApplicationsCsv, escapeCsvCell } from '@/lib/csv';

const HEADER = 'Company,Role,Recruiter email,Stage,Sent date,Opened,Replied,Follow-ups';

function makeSummary(overrides: Partial<ApplicationSummary> = {}): ApplicationSummary {
  return {
    id: 'app-1',
    company: 'Acme',
    role: 'Frontend Engineer',
    hrName: 'Priya',
    hrEmail: 'priya@acme.com',
    stage: 'applied',
    daysSinceSent: 2,
    lastEmail: {
      kind: 'initial',
      sentAt: '2026-08-03T09:15:00.000Z',
      openedAt: '2026-08-04T10:00:00.000Z',
      repliedAt: null,
      bouncedAt: null,
    },
    nextFollowUpAt: '2026-08-06T09:15:00.000Z',
    interviewAt: null,
    interviewNote: null,
    createdAt: '2026-08-03T09:00:00.000Z',
    ...overrides,
  };
}

describe('buildApplicationsCsv', () => {
  it('returns only the header row for an empty list', () => {
    expect(buildApplicationsCsv([])).toBe(HEADER);
  });

  it('serializes a real summary fixture with derived columns', () => {
    const csv = buildApplicationsCsv([makeSummary()]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe(HEADER);
    expect(row).toBe('Acme,Frontend Engineer,priya@acme.com,applied,2026-08-03,2026-08-04,,0');
  });

  it('derives the follow-up count from lastEmail.kind', () => {
    const csv = buildApplicationsCsv([
      makeSummary({ id: 'a', lastEmail: { kind: 'followup_1', sentAt: '2026-08-01T00:00:00.000Z', openedAt: null, repliedAt: null, bouncedAt: null } }),
      makeSummary({ id: 'b', lastEmail: { kind: 'followup_2', sentAt: '2026-08-02T00:00:00.000Z', openedAt: null, repliedAt: '2026-08-03T05:00:00.000Z', bouncedAt: null } }),
      makeSummary({ id: 'c', lastEmail: null }),
    ]);
    const rows = csv.split('\r\n').slice(1);
    expect(rows[0].endsWith(',1')).toBe(true);
    expect(rows[1]).toContain(',2026-08-03,2'); // replied date + 2 follow-ups
    expect(rows[2]).toBe('Acme,Frontend Engineer,priya@acme.com,applied,,,,0');
  });

  it('quotes cells containing commas, quotes, and newlines (RFC 4180)', () => {
    const csv = buildApplicationsCsv([
      makeSummary({
        company: 'Acme, Inc.',
        role: 'Engineer "L4"',
        hrEmail: 'a@b.com',
        lastEmail: null,
      }),
      makeSummary({ id: 'app-2', company: 'Line\nBreak Co', lastEmail: null }),
    ]);
    expect(csv).toContain('"Acme, Inc."');
    expect(csv).toContain('"Engineer ""L4"""');
    expect(csv).toContain('"Line\nBreak Co"');
  });

  it('neutralizes spreadsheet formula injection with a leading single quote', () => {
    const csv = buildApplicationsCsv([
      makeSummary({ company: '=SUM(A1:A9)', role: '+cmd', hrEmail: 'x@y.com', lastEmail: null }),
      makeSummary({ id: 'app-2', company: '-1+2', role: '@import', lastEmail: null }),
    ]);
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-1+2");
    expect(csv).toContain("'@import");
  });

  it('quotes AND neutralizes a formula cell that also contains a comma', () => {
    const csv = buildApplicationsCsv([
      makeSummary({ company: '=HYPERLINK("http://evil","x"),boom', lastEmail: null }),
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""x""),boom"');
  });
});

describe('escapeCsvCell', () => {
  it('passes plain cells through untouched', () => {
    expect(escapeCsvCell('Acme')).toBe('Acme');
  });
});

describe('applicationsCsvFilename', () => {
  it('formats the local date with zero padding', () => {
    expect(applicationsCsvFilename(new Date(2026, 0, 5))).toBe(
      'gethired-applications-2026-01-05.csv',
    );
  });
});
