import { SKILL_KEYWORDS, type ResumePrefill } from '@jobmail/shared';

/**
 * Rule-based résumé reader — the fallback when Gemini is off/unavailable, and a
 * cross-check on what Gemini returns (dates → years of experience, regex-verified
 * email/phone/links). Deliberately conservative: a field it cannot read with
 * confidence stays null/empty rather than being filled with junk.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/;

const MONTHS =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const ROLE_WORDS =
  /\b(developer|engineer|analyst|designer|architect|manager|scientist|consultant|specialist|lead|administrator|programmer|intern|trainee|associate|officer|executive|founder|devops|sre|qa|tester)\b/i;

const SECTION_HEADINGS: Array<[RegExp, string]> = [
  [/^(professional\s+|career\s+|executive\s+)?(summary|profile|objective|about(\s+me)?|overview)$/i, 'summary'],
  [/^((work|professional|employment|relevant|industry)\s+)?(experience|history)(\s+history)?$|^employment$/i, 'experience'],
  [/^education(al)?(\s+(background|qualifications?))?$|^academics?$/i, 'education'],
  [/^((key|personal|academic|selected)\s+)?projects?$/i, 'projects'],
  [/^((technical|core|key|it)\s+)?(skills?|technologies|tech\s+stack|competencies)(\s+(&|and)\s+tools)?$/i, 'skills'],
  [/^(certifications?|courses?|achievements?|awards?|accomplishments?|languages?|interests?|hobbies|publications?|references?|extra[\s-]?curriculars?|activities|training)$/i, 'other'],
];

/** "Title Case" an ALL-CAPS/all-lowercase name; leave mixed-case names alone. */
export function titleCaseName(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (!letters || (letters !== letters.toUpperCase() && letters !== letters.toLowerCase())) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'’.-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim());
}

function headingKind(line: string): string | null {
  const bare = line.replace(/[:：\-–—_•*|]+$/g, '').replace(/^[•*|\-–—\s]+/, '').trim();
  if (!bare || bare.length > 40) return null;
  for (const [re, kind] of SECTION_HEADINGS) if (re.test(bare)) return kind;
  return null;
}

/** Split into named sections; text before the first heading is the 'header'. */
export function splitSections(text: string): Record<string, string> {
  const sections: Record<string, string[]> = { header: [] };
  let current = 'header';
  for (const line of lines(text)) {
    const kind = headingKind(line);
    if (kind) {
      current = kind === 'other' ? `other:${line}` : kind;
      sections[current] ??= [];
      continue;
    }
    (sections[current] ??= []).push(line);
  }
  return Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n').trim()]));
}

/** Case-insensitive, boundary-aware match of the shared skill list against text. */
export function matchSkills(text: string): string[] {
  const haystack = text.toLowerCase();
  return SKILL_KEYWORDS.filter((skill) => {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // C++ / C# etc. have no word boundary at the end — use lookaround instead.
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(haystack);
  });
}

/** Skills in the order they first appear in `text` (most prominent first). */
function orderByAppearance(skills: string[], text: string): string[] {
  const lower = text.toLowerCase();
  const pos = (s: string) => {
    const i = lower.indexOf(s.toLowerCase());
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...skills].sort((a, b) => pos(a) - pos(b));
}

/** Extra skills spelled out in a "Skills" section, e.g. "Databases: MongoDB, Mongoose, Redis". */
function skillsFromSection(section: string): string[] {
  const found: string[] = [];
  for (const line of section.split('\n')) {
    const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    for (const raw of body.split(/[,;•|·]/)) {
      const token = raw.replace(/^[\s\-–•*]+|[\s.]+$/g, '').trim();
      if (token.length < 2 || token.length > 30) continue;
      if (token.split(/\s+/).length > 3) continue;
      if (/[.!?]$|@|https?:|\d{4}/.test(token)) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9 .+#/&()'-]*$/.test(token)) continue;
      found.push(token);
    }
  }
  return found;
}

/** Canonicalise against the shared list (case-insensitive) so "nodejs"/"Node.js" don't both appear. */
function canonicalSkill(token: string): string {
  const key = token.toLowerCase().replace(/[\s.]+/g, '');
  const hit = SKILL_KEYWORDS.find((s) => s.toLowerCase().replace(/[\s.]+/g, '') === key);
  return hit ?? token;
}

export function extractSkills(text: string, sections: Record<string, string>): string[] {
  const inSkills = sections.skills ?? '';
  const ordered = orderByAppearance(matchSkills(text), inSkills || text);
  const extras = skillsFromSection(inSkills).map(canonicalSkill);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...ordered, ...extras]) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= 30) break;
  }
  return out;
}

export function extractEmail(text: string): string | null {
  return text.match(EMAIL_RE)?.[0]?.replace(/[.,;]+$/, '') ?? null;
}

/** Phone: 10–13 digits once formatting is stripped; ignores date ranges / CGPA / years. */
export function extractPhone(text: string): string | null {
  const re = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{3,6}/g;
  for (const m of text.matchAll(re)) {
    const candidate = m[0].trim();
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    // Skip things like 2021-2025 2026 (only years) or long numeric IDs glued to letters.
    const before = text[(m.index ?? 0) - 1] ?? ' ';
    const after = text[(m.index ?? 0) + candidate.length] ?? ' ';
    if (/[A-Za-z0-9]/.test(before) || /\d/.test(after)) continue;
    if (/^(19|20)\d{2}\D+(19|20)\d{2}/.test(candidate)) continue;
    return candidate;
  }
  return null;
}

function toHttps(url: string): string {
  const trimmed = url.trim().replace(/[),.;/]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** LinkedIn / GitHub / personal-site URLs from the text and the PDF's real hyperlinks. */
export function extractLinks(text: string, urls: string[] = []): ResumePrefill['links'] {
  const links = { linkedin: '', github: '', portfolio: '' };
  const pool = [
    ...urls.filter((u) => /^https?:/i.test(u)),
    ...(text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,;|<>()]*)?/gi) ?? []),
  ];
  const emailDomains = new Set(
    (text.match(new RegExp(EMAIL_RE.source, 'g')) ?? []).map((e) => e.split('@')[1]!.toLowerCase()),
  );
  const isEmailHost = (u: string) => {
    const host = u.replace(/^https?:\/\//i, '').split('/')[0]!.toLowerCase();
    return emailDomains.has(host) || /^(gmail|yahoo|outlook|hotmail|icloud)\./.test(host);
  };
  for (const raw of pool) {
    const u = raw.trim().replace(/[),.;]+$/, '');
    if (isEmailHost(u) && !/linkedin|github/i.test(u)) continue;
    if (!links.linkedin && /linkedin\.com\/(in|pub)\/[^\s/?#]+/i.test(u)) {
      links.linkedin = toHttps(u.match(/(?:https?:\/\/)?(?:[a-z]+\.)?linkedin\.com\/(?:in|pub)\/[^\s/?#]+/i)![0]);
    } else if (!links.github && /github\.com\/[A-Za-z0-9-]+\/?$/i.test(u)) {
      links.github = toHttps(u.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+/i)![0]);
    } else if (
      !links.portfolio &&
      !/linkedin\.com|github\.com|gitlab\.com|leetcode|hackerrank|codeforces|codechef|geeksforgeeks|twitter\.com|x\.com|instagram|facebook|youtube|medium\.com|mailto:|google\.com|drive\./i.test(u) &&
      /^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:app|dev|io|me|tech|xyz|site|online|in|com|co|net|org|codes|page|studio|design)(?:\/|$)/i.test(u) &&
      !/\.(?:pdf|png|jpe?g)$/i.test(u) &&
      /[a-z]/i.test(u.split('.')[0]!)
    ) {
      links.portfolio = toHttps(u);
    }
  }
  // GitHub profile only (not a repo URL): fall back to the first github.com URL's owner.
  if (!links.github) {
    const m = pool.join(' ').match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)/i);
    if (m) links.github = `https://github.com/${m[1]}`;
  }
  return links;
}

export function guessFullName(text: string): string | null {
  const top = lines(text).filter(Boolean).slice(0, 6);
  for (const line of top) {
    // Names often share a line with contact info: keep only what precedes it.
    const head = line.split(/\s*(?:[|•·]|phone|mobile|email|e-mail|contact|tel|linkedin|github|portfolio)\b/i)[0]!.trim();
    if (!head || EMAIL_RE.test(head) || /https?:\/\/|www\./i.test(head) || /\d/.test(head)) continue;
    const words = head.split(/\s+/);
    const looksLikeName =
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Za-z][A-Za-z'’.-]*$/.test(w)) &&
      head.length <= 40 &&
      !ROLE_WORDS.test(head) &&
      headingKind(head) === null;
    if (looksLikeName) return titleCaseName(head);
  }
  return null;
}

/* ── Experience: dates → years ───────────────────────────────────── */

function monthNumber(token: string, year: number): number {
  return year * 12 + (MONTH_INDEX[token.slice(0, 3).toLowerCase()] ?? 0);
}

/** Merge overlapping [start,end] month intervals so parallel jobs aren't double-counted. */
function unionMonths(ranges: Array<[number, number]>): number {
  const sorted = ranges.filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of sorted) {
    if (curS < 0) {
      curS = s;
      curE = e;
    } else if (s <= curE + 1) {
      curE = Math.max(curE, e);
    } else {
      total += curE - curS + 1;
      curS = s;
      curE = e;
    }
  }
  if (curS >= 0) total += curE - curS + 1;
  return total;
}

/**
 * Years of professional experience from the dated entries of the Experience
 * section only (education and projects have dates too). Null when there's no
 * Experience section or no readable dates.
 */
export function yearsFromExperience(experience: string, now = new Date()): number | null {
  if (!experience) return null;
  const nowMonth = now.getFullYear() * 12 + now.getMonth();
  const END = `(present|current|now|till\\s*date|to\\s*date|ongoing|${MONTHS})\\.?[\\s,'’-]*(\\d{4})?`;
  const re = new RegExp(
    `(${MONTHS})\\.?[\\s,'’-]*(\\d{4})\\s*(?:-|–|—|to|until)\\s*${END}`,
    'gi',
  );
  const ranges: Array<[number, number]> = [];
  for (const m of experience.matchAll(re)) {
    const start = monthNumber(m[1]!, Number(m[2]));
    const endTok = m[3]!.toLowerCase();
    let end: number;
    if (/^(present|current|now|till|to|ongoing)/.test(endTok)) end = nowMonth;
    else if (m[4]) end = monthNumber(endTok, Number(m[4]));
    else continue;
    if (end > nowMonth) end = nowMonth;
    if (start <= end) ranges.push([start, end]);
  }
  // Numeric months: 04/2026 - Present, 10/2025 - 01/2026
  for (const m of experience.matchAll(/\b(0?[1-9]|1[0-2])[/.](\d{4})\s*(?:-|–|—|to)\s*(?:(present|current|now)|(0?[1-9]|1[0-2])[/.](\d{4}))/gi)) {
    const start = Number(m[2]) * 12 + Number(m[1]) - 1;
    const end = m[3] ? nowMonth : Number(m[5]) * 12 + Number(m[4]) - 1;
    if (start <= Math.min(end, nowMonth)) ranges.push([start, Math.min(end, nowMonth)]);
  }
  // Year-only ranges: 2019 – Present, 2018 - 2021
  if (ranges.length === 0) {
    for (const m of experience.matchAll(/\b((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)\b/gi)) {
      const start = Number(m[1]) * 12;
      const end = /^\d/.test(m[2]!) ? Number(m[2]) * 12 + 11 : nowMonth;
      if (start <= Math.min(end, nowMonth)) ranges.push([start, Math.min(end, nowMonth)]);
    }
  }
  if (ranges.length === 0) return null;
  const months = unionMonths(ranges);
  return Math.min(50, Math.round((months / 12) * 10) / 10);
}

/** "5+ years of experience" style claims, used only when no dated experience is readable. */
function yearsFromPhrase(text: string): number | null {
  const m = text.match(/\b(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b(?:\s+of)?(?:\s+\w+){0,3}\s+(?:experience|exp)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 50 ? n : null;
}

/* ── Headline / location ─────────────────────────────────────────── */

function cleanTitle(line: string): string {
  return line
    .replace(/\(?\b(?:19|20)\d{2}\b.*$/, '')
    .replace(new RegExp(`\\b(?:${MONTHS})\\b.*$`, 'i'), '')
    .split(/\s+(?:at|@)\s+|\s*[|,–—]\s*|\s+-\s+/i)[0]!
    .replace(/[\s\-–—:|,]+$/g, '')
    .trim();
}

function guessHeadline(sections: Record<string, string>, name: string | null): string | null {
  const header = lines(sections.header ?? '').filter(Boolean).slice(0, 8);
  for (const line of header) {
    if (name && line.toLowerCase().startsWith(name.toLowerCase()) && line.length < name.length + 3) continue;
    // "Data Analyst | Kochi, Kerala | me@x.com": look at each segment on its own.
    for (const seg of line.split(/\s*[|·•]\s*/)) {
      const part = seg.trim();
      if (!part || EMAIL_RE.test(part) || /https?:\/\/|www\.|\d{5,}/.test(part)) continue;
      if (part.length > 80 || part.split(/\s+/).length > 9) continue;
      if (ROLE_WORDS.test(part) && headingKind(part) === null) return part;
    }
  }
  // Most recent role in the Experience section: first entry line with a role word.
  for (const line of lines(sections.experience ?? '').filter(Boolean).slice(0, 8)) {
    if (line.length <= 90 && ROLE_WORDS.test(line) && !/^[•*-]/.test(line)) {
      const title = cleanTitle(line);
      if (title.length >= 3 && title.length <= 70) return title;
    }
  }
  return null;
}

const CITIES =
  'Bengaluru|Bangalore|Mumbai|New Delhi|Delhi|Gurugram|Gurgaon|Noida|Greater Noida|Ghaziabad|Faridabad|Hyderabad|Chennai|Pune|Kolkata|Ahmedabad|Jaipur|Lucknow|Chandigarh|Mohali|Kochi|Trivandrum|Thiruvananthapuram|Coimbatore|Indore|Bhopal|Nagpur|Surat|Vadodara|Patna|Bhubaneswar|Visakhapatnam|Mysuru|Mysore|Remote|London|New York|San Francisco|Seattle|Austin|Toronto|Vancouver|Singapore|Dubai|Berlin|Amsterdam|Sydney|Melbourne';
const CITY_RE = new RegExp(`\\b(${CITIES})\\b(?:\\s*,\\s*([A-Z][A-Za-z.]+(?: [A-Z][A-Za-z.]+){0,2}))?`);
const LOCATION_RE =
  /\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}),\s*([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2})\b/;
const INSTITUTION_RE = /\b(university|institute|college|school|academy|technology and management|polytechnic)\b/i;
const COMPANY_WORD_RE = /\b(pvt|private|ltd|limited|llp|inc|llc|corp|technologies|solutions|services|systems|labs|software|consulting)\b\.?/i;

function guessLocation(sections: Record<string, string>): string | null {
  const scan = (block: string, max: number, generic: boolean) => {
    for (const line of lines(block).filter(Boolean).slice(0, max)) {
      if (INSTITUTION_RE.test(line)) continue;
      const labelled = line.match(/(?:location|address|city|based in)\s*[:\-]\s*(.+)$/i);
      if (labelled) return labelled[1]!.trim().slice(0, 100);
      const known = line.replace(EMAIL_RE, ' ').match(CITY_RE);
      if (known) return known[2] && !ROLE_WORDS.test(known[2]) ? `${known[1]}, ${known[2]}` : known[1]!;
      if (!generic || /@|https?:|www\./i.test(line)) continue;
      const m = line.match(LOCATION_RE);
      if (m && !ROLE_WORDS.test(m[0]) && !COMPANY_WORD_RE.test(m[0]) && !/^(Bachelor|Master|Node|Next|Express)/.test(m[1]!)) {
        return `${m[1]}, ${m[2]}`;
      }
    }
    return null;
  };
  return scan(sections.header ?? '', 8, true) ?? scan(sections.experience ?? '', 8, false);
}

/* ── Summary ─────────────────────────────────────────────────────── */

function trimToSentences(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastPeriod = cut.lastIndexOf('. ');
  if (lastPeriod > max * 0.5) return cut.slice(0, lastPeriod + 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function yearsPhrase(years: number): string {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))} months of`;
  const rounded = years >= 3 ? Math.round(years) : Math.round(years * 2) / 2;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} ${rounded === 1 ? 'year' : 'years'} of`;
}

/** Objective statements that say nothing about the candidate — never used as the summary. */
const CLICHE_SUMMARY =
  /\b(seeking|looking for|looking to|challenging (?:position|role)|reputed|esteemed|utili[sz]e my|leverage my|opportunity to (?:work|grow|learn)|hard[- ]?working|team player|self[- ]?motivated|highly motivated)\b/i;

/** Discipline inferred from the tools the résumé lists. */
function inferRole(skills: string[]): string {
  const has = (...names: string[]) => names.some((n) => skills.some((s) => s.toLowerCase() === n.toLowerCase()));
  const front = has('React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Redux', 'React Native', 'Flutter');
  const back = has('Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Rails', 'Laravel', 'gRPC', 'Microservices');
  const ml = has('Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'LLM', 'NLP', 'scikit-learn');
  const data = has('Pandas', 'NumPy', 'Data Analysis', 'Spark', 'Airflow');
  const devops = has('Kubernetes', 'Terraform', 'Docker', 'Jenkins', 'GitHub Actions');
  if (front && back) return 'Full Stack Developer';
  if (ml) return 'Machine Learning Engineer';
  if (data) return 'Data Analyst';
  if (front) return 'Frontend Developer';
  if (back) return 'Backend Developer';
  if (devops) return 'DevOps Engineer';
  return 'Software Developer';
}

const LANGUAGES = new Set(
  ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c++', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'sql', 'bash'],
);
const LOW_SIGNAL = new Set(['html', 'css', 'git', 'agile', 'scrum', 'testing', 'ci/cd', 'figma', 'linux', 'rest api', 'tailwind css']);

/** Headline stack for a one-line summary: frameworks/data/cloud first, then languages. */
function summaryStack(skills: string[]): string[] {
  const core = skills.filter((s) => !LANGUAGES.has(s.toLowerCase()) && !LOW_SIGNAL.has(s.toLowerCase()));
  const langs = skills.filter((s) => LANGUAGES.has(s.toLowerCase()) && s.toLowerCase() !== 'sql');
  return [...core.slice(0, 4), ...langs.slice(0, 2)].slice(0, 6);
}

/** A short professional summary built from what was actually read — never the raw résumé text. */
function composeSummary(p: {
  headline: string | null;
  years: number | null;
  skills: string[];
  written: string;
}): string {
  // Their own summary section wins — it's their voice, just tidied — unless it's a generic objective.
  const written = p.written.replace(/\s+/g, ' ').trim();
  if (written.length >= 60 && !CLICHE_SUMMARY.test(written)) return trimToSentences(written, 480);
  const stack = summaryStack(p.skills);
  const role = p.headline ?? (stack.length >= 2 ? inferRole(p.skills) : null);
  if (!role) return '';
  const list = stack.length >= 2 ? joinList(stack) : '';
  if (p.years && p.years > 0) {
    return `${role} with ${yearsPhrase(p.years)} hands-on experience${list ? ` in ${list}` : ''}.`;
  }
  return list ? `${role} skilled in ${list}.` : `${role}.`;
}

/* ── Entry point ─────────────────────────────────────────────────── */

export function parseResumeHeuristic(
  text: string,
  urls: string[] = [],
  now = new Date(),
  geometricText = '',
): ResumePrefill {
  const sections = splitSections(text);
  const fullName = guessFullName(text);
  const skills = extractSkills(text, sections);
  const foundHeadline = guessHeadline(sections, fullName);
  const stack = summaryStack(skills);
  // No title on the résumé (typical for freshers): infer the discipline from the tools listed.
  const headline =
    foundHeadline ?? (stack.length >= 2 ? `${inferRole(skills)} · ${stack.slice(0, 2).join(' · ')}` : null);
  const yearsExp =
    yearsFromExperience(sections.experience ?? '', now) ??
    (geometricText ? yearsFromExperience(splitSections(geometricText).experience ?? '', now) : null) ??
    yearsFromPhrase(text) ??
    // Education/projects but no work-history section at all → a fresher, not "unknown".
    (!sections.experience && (sections.education || sections.projects) ? 0 : null);
  return {
    fullName,
    headline,
    email: extractEmail(text),
    phone: extractPhone(sections.header || text.slice(0, 600)) ?? extractPhone(text),
    location: guessLocation(sections),
    yearsExp,
    skills,
    links: extractLinks(text, urls),
    summary: composeSummary({ headline: foundHeadline, years: yearsExp, skills, written: sections.summary ?? '' }),
    preferredRoles: [],
    source: 'basic',
  };
}
