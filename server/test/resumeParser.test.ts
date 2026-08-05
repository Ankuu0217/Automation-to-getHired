import { describe, expect, it } from 'vitest';
import {
  buildSummary,
  guessFullName,
  matchSkills,
  parseResumeText,
} from '../src/services/resumeParser';

const SAMPLE = `
Jane Doe
Senior Software Engineer
jane.doe@example.com | +1 415 555 0132 | https://linkedin.com/in/janedoe

Experienced engineer with 7 years building web applications with TypeScript,
React, Node.js and MongoDB. Deployed on AWS with Docker and Kubernetes.
Previously worked with Python, Django and PostgreSQL.
`;

describe('resumeParser pure helpers', () => {
  it('matches skills case-insensitively without substring false positives', () => {
    const skills = matchSkills(SAMPLE);
    expect(skills).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Node.js', 'MongoDB', 'AWS', 'Docker', 'Kubernetes', 'Python', 'Django', 'PostgreSQL']),
    );
    // "R" must not match the letter R inside words
    expect(matchSkills('I really like racing cars')).not.toContain('R');
    // C++ should match literally
    expect(matchSkills('wrote C++ for years')).toContain('C++');
  });

  it('builds a summary capped near 500 chars at a clean boundary', () => {
    const long = 'Sentence one. '.repeat(100);
    const summary = buildSummary(long);
    expect(summary.length).toBeLessThanOrEqual(501);
    expect(summary.endsWith('.') || summary.endsWith('…')).toBe(true);
  });

  it('guesses a full name from the first plausible line', () => {
    expect(guessFullName(SAMPLE)).toBe('Jane Doe');
    expect(guessFullName('jane@x.com\nnot a name here!!!')).toBeNull();
  });

  it('extracts email and phone from text', () => {
    const prefill = parseResumeText(SAMPLE);
    expect(prefill.email).toBe('jane.doe@example.com');
    expect(prefill.phone).toBeTruthy();
    expect(prefill.skills.length).toBeGreaterThan(3);
  });
});
