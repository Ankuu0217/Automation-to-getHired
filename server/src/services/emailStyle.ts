/**
 * Style fingerprint of an outreach email, captured at send time so reply
 * rates can be compared across the choices the user actually makes.
 */
export interface EmailStyle {
  tone: string | null;
  length: 'short' | 'medium' | 'long';
  format: 'bullets' | 'paragraphs';
  subject: 'application-for' | 'role-name' | 'other';
  dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
}

export function describeStyle(draft: { subject: string; bodyText: string }, tone: string | null, sentAt: Date): EmailStyle {
  const body = draft.bodyText.split(/\n\s*(best regards|warm regards|regards|thanks|sincerely)[,.]?\s*\n/i)[0] ?? draft.bodyText;
  const words = body.split(/\s+/).filter(Boolean).length;
  const hour = sentAt.getHours();
  return {
    tone,
    length: words < 110 ? 'short' : words <= 170 ? 'medium' : 'long',
    format: /^\s*[-•*]\s+/m.test(body) ? 'bullets' : 'paragraphs',
    subject: /^application (for|:)/i.test(draft.subject.trim()) ? 'application-for' : /\s[-|–]\s/.test(draft.subject) ? 'role-name' : 'other',
    dayPart: hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night',
  };
}
