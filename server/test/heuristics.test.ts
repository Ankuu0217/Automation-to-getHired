import { describe, expect, it } from 'vitest';

import { extractFromText } from '../src/services/ai/heuristics';

describe('extractFromText heuristics', () => {
  it('does not truncate roles containing "at"/"in" substrings', () => {
    const jd =
      'Acme Robotics is hiring a Senior Platform Engineer in Berlin, Germany. Contact recruiter Jana Fischer at jana.fischer@acmerobotics.example to apply.';
    const { extraction } = extractFromText(jd);
    expect(extraction.role).toBe('Senior Platform Engineer');
    expect(extraction.company).toBe('Acme Robotics');
    expect(extraction.hrEmails[0]?.email).toBe('jana.fischer@acmerobotics.example');
  });

  it('still terminates roles at standalone "in"/"at"/"to join"', () => {
    const jd = 'Craftly is looking for a Data Analyst to join our insights team.';
    expect(extractFromText(jd).extraction.role).toBe('Data Analyst');
  });
});
