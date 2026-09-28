import { env } from '../config/env';

/**
 * Branded HTML for the emails GetHired itself sends (verification, interview
 * reminder). Mirrors the landing page: near-black ink canvas, ONE lime accent,
 * mono micro-labels, hairline borders, zero shadows.
 *
 * Email-client rules baked in (Gmail/Outlook/Apple Mail): table layout, inline
 * styles only, `bgcolor` attributes next to background styles (so dark-mode
 * clients that strip CSS still get the dark canvas), no images/web-fonts (both
 * are blocked or unreliable by default) — the wordmark is text, fonts fall back
 * to the system stack. A hidden preheader controls the inbox preview line.
 *
 * NOT used for outreach to recruiters: those go out from the user's own Gmail
 * and must read as a plain personal email (see emailRules.emailBodyToHtml).
 */

const C = {
  canvas: '#0d1a17',
  ink: '#222f30',
  ink2: '#1b2526',
  ink3: '#2a3737',
  lime: '#cef79e',
  paper: '#ffffff',
  text2: '#93a29f',
  text3: '#6d7c7a',
  hairline: '#2f3f3f',
} as const;

const SANS = "'Aspekta','Inter Tight',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'Roboto Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function appUrl(path = ''): string {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}${path}`;
}

export interface EmailShell {
  /** Inbox preview line (hidden in the body). */
  preheader: string;
  /** Small mono label above the headline, e.g. "Account". */
  eyebrow: string;
  /** Main headline (plain text — escaped here). */
  headline: string;
  /** Inner HTML for the body (already escaped by the caller). */
  bodyHtml: string;
  /** Optional lime call-to-action button. */
  cta?: { label: string; url: string };
  /** Small print under the card. */
  footnote?: string;
}

function button(label: string, url: string): string {
  // Bulletproof button: a padded table cell carries the colour, so it survives
  // clients that ignore padding/background on <a>.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0"><tr>
    <td bgcolor="${C.lime}" style="background-color:${C.lime};border-radius:10px">
      <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:600;color:${C.ink};text-decoration:none;border-radius:10px">${escapeHtml(label)}&nbsp;&nbsp;&rarr;</a>
    </td></tr></table>`;
}

/** Wrap content in the GetHired shell: wordmark, dark card, hairline footer. */
export function renderEmail(shell: EmailShell): string {
  const { preheader, eyebrow, headline, bodyHtml, cta, footnote } = shell;
  const fallback = cta
    ? `<p style="margin:20px 0 0;font-family:${MONO};font-size:12px;line-height:18px;color:${C.text3}">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(cta.url)}" style="color:${C.text2};word-break:break-all;text-decoration:underline">${escapeHtml(cta.url)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas}">${escapeHtml(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background-color:${C.canvas}">
<tr><td align="center" style="padding:40px 16px 48px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
    <tr><td style="padding:0 4px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${SANS};font-size:20px;line-height:24px;color:${C.paper};letter-spacing:-0.02em"><span style="color:${C.lime}">&#8734;</span>&nbsp;GetHired</td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.ink}" style="background-color:${C.ink};border:1px solid ${C.hairline};border-radius:20px;padding:36px 32px">
      <p style="margin:0 0 20px;font-family:${MONO};font-size:12px;line-height:16px;letter-spacing:0.04em;text-transform:uppercase;color:${C.text2}"><span style="display:inline-block;width:6px;height:6px;border-radius:3px;background-color:${C.lime};vertical-align:middle;margin-right:10px">&nbsp;</span>${escapeHtml(eyebrow)}</p>
      <h1 style="margin:0 0 16px;font-family:${SANS};font-size:30px;line-height:36px;font-weight:400;letter-spacing:-0.03em;color:${C.paper}">${escapeHtml(headline)}</h1>
      <div style="font-family:${SANS};font-size:16px;line-height:25px;color:${C.text2}">${bodyHtml}</div>
      ${cta ? button(cta.label, cta.url) : ''}
      ${fallback}
    </td></tr>
    <tr><td style="padding:22px 8px 0;font-family:${MONO};font-size:11px;line-height:17px;letter-spacing:0.02em;color:${C.text3}">
      ${footnote ? `${escapeHtml(footnote)}<br><br>` : ''}GETHIRED &middot; FROM SCREENSHOT TO SENT<br>You get this because of activity on your GetHired account.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Signup verification (system sender). */
export function verificationEmail(link: string): BuiltEmail {
  const subject = 'Verify your email to start sending';
  const text = [
    'Welcome to GetHired.',
    '',
    'Confirm this is your email so you can start sending outreach. Open the link below:',
    link,
    '',
    'This link expires in 24 hours.',
    '',
    "If you didn't create a GetHired account, ignore this email.",
  ].join('\n');
  const html = renderEmail({
    preheader: 'One click to confirm your email and start sending outreach.',
    eyebrow: 'Account · Verify',
    headline: 'Verify your email to start sending.',
    bodyHtml:
      '<p style="margin:0 0 12px">Confirm this is your email so GetHired can send outreach on your behalf.</p>' +
      `<p style="margin:0;color:${C.text3};font-size:14px;line-height:22px">The link is valid for 24 hours and works once.</p>`,
    cta: { label: 'Verify email', url: link },
    footnote: "Didn't create a GetHired account? You can safely ignore this email.",
  });
  return { subject, text, html };
}

export interface InterviewReminderInput {
  company: string;
  role?: string | null;
  /** Already formatted, timezone included (e.g. "Tue, Sep 30, 3:00 PM GMT+5:30"). */
  when: string;
  note?: string | null;
}

function detailRow(label: string, value: string, last = false): string {
  return `<tr>
    <td style="padding:14px 0;${last ? '' : `border-bottom:1px solid ${C.hairline};`}font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:0.04em;text-transform:uppercase;color:${C.text3};width:96px;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:14px 0;${last ? '' : `border-bottom:1px solid ${C.hairline};`}font-family:${SANS};font-size:16px;line-height:24px;color:${C.paper};vertical-align:top">${escapeHtml(value).replace(/\n/g, '<br>')}</td>
  </tr>`;
}

/** 24h-ahead interview reminder sent to the user's own address. */
export function interviewReminderEmail(input: InterviewReminderInput): BuiltEmail {
  const { company, role, when, note } = input;
  const subject = `Interview with ${company} tomorrow`;
  const lines: string[] = [`Your interview with ${company} is coming up.`];
  if (role) lines.push(`Role: ${role}`);
  lines.push(`Time: ${when}`);
  if (note) lines.push(`Note: ${note}`);
  lines.push('Good luck!');
  const text = lines.join('\n\n');

  const rows = [detailRow('Company', company)];
  if (role) rows.push(detailRow('Role', role));
  rows.push(detailRow('Time', when, !note));
  if (note) rows.push(detailRow('Note', note, true));

  const html = renderEmail({
    preheader: `${when} · ${company}${role ? ` · ${role}` : ''}`,
    eyebrow: 'Interview · Tomorrow',
    headline: `Your interview with ${company} is coming up.`,
    bodyHtml:
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;border-top:1px solid ${C.hairline}">${rows.join('')}</table>` +
      `<p style="margin:20px 0 0;color:${C.paper}">Good luck. You&rsquo;ve got this.</p>`,
    cta: { label: 'Open pipeline', url: appUrl('/pipeline') },
  });
  return { subject, text, html };
}
