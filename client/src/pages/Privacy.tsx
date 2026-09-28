import { Link } from 'react-router-dom';

import { Mono } from '@/components/Mono';

/**
 * Public privacy policy (/privacy). Google requires a public policy on the
 * app's own domain — linked from the OAuth consent screen and the homepage —
 * before it will verify the `gmail.send` scope (unverified apps stop at 100
 * users). It must include the Limited Use disclosure below.
 *
 * NOTE for the owner: review this text (it is not legal advice) and set
 * VITE_CONTACT_EMAIL so the contact line shows your support address.
 */

const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'the support address listed on this site';
const UPDATED = '29 September 2026';
/** Set VITE_GEMINI_PAID=true once Gemini billing is on (paid-tier content isn't used to improve Google's models). */
const GEMINI_PAID = import.meta.env.VITE_GEMINI_PAID === 'true';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-sans text-xl font-normal text-paper">{title}</h2>
      <div className="space-y-3 font-sans text-[15px] leading-relaxed text-text-2-dark">{children}</div>
    </section>
  );
}

export function Privacy() {
  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <article className="mx-auto max-w-[760px] space-y-10">
        <header className="space-y-3">
          <Link to="/" className="font-mono text-[13px] uppercase tracking-[-0.02em] text-text-2-dark hover:text-paper">
            ← GetHired
          </Link>
          <h1 className="font-sans text-4xl font-normal text-paper">Privacy policy</h1>
          <Mono size="xs" color="fog">
            LAST UPDATED · {UPDATED.toUpperCase()}
          </Mono>
        </header>

        <Section title="What GetHired does">
          <p>
            GetHired turns a job post (a screenshot or pasted text) into a personalised outreach email that you
            review and send from your own Gmail account, then tracks replies and follow-ups for you.
          </p>
        </Section>

        <Section title="Data we collect">
          <ul className="list-disc space-y-2 pl-5">
            <li>Account: your name, email address and a hashed password (we never store it in plain text).</li>
            <li>Profile: details you enter (headline, skills, experience, links) and the résumé PDF you upload, plus its extracted text.</li>
            <li>Job posts: screenshots or text you submit, and the details extracted from them (company, role, recruiter name and email).</li>
            <li>Outreach: the emails you approve, their send status, and whether they were opened (via a tracking pixel) or replied to.</li>
            <li>Gmail connection: an OAuth token that lets GetHired send email on your behalf, encrypted at rest (AES-256-GCM).</li>
          </ul>
        </Section>

        <Section title="How we use Google user data">
          <p>
            GetHired requests only the <code className="text-paper">gmail.send</code> permission. It is used solely to
            send the outreach and follow-up emails that you have reviewed or scheduled, from your account, with your
            résumé attached. GetHired cannot read, search or delete the emails in your mailbox.
          </p>
          <p>
            GetHired&apos;s use and transfer of information received from Google APIs will adhere to the{' '}
            <a
              className="text-paper underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We do not sell Google user data, use it for advertising, or use
            it to train AI models.
          </p>
        </Section>

        <Section title="Service providers">
          <p>We share data only with the providers needed to run the service, under their own security terms:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>MongoDB Atlas: database hosting.</li>
            <li>ImageKit: private storage for résumés and screenshots (accessible only via short-lived signed links).</li>
            <li>
              Google Gemini API: reads job-post screenshots/text and drafts emails from your profile.
              {!GEMINI_PAID && (
                <>
                  {' '}
                  We currently use Gemini&apos;s free tier: under Google&apos;s terms, Google may use the content we
                  send it (job posts, your profile and résumé text) to improve its products, and human reviewers may
                  read it. Avoid including information you don&apos;t want processed this way.
                </>
              )}
            </li>
            <li>Our hosting provider and email provider: to run the app and send account verification emails.</li>
          </ul>
        </Section>

        <Section title="Retention and deletion">
          <p>
            Job screenshots are deleted automatically after 30 days; the extracted job details stay with your
            application history. You can delete your account at any time from Settings. This permanently removes your
            profile, résumé, screenshots, applications and email history, and revokes GetHired&apos;s access to your
            Gmail. You can also revoke access any time from your Google Account security settings.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Traffic is encrypted with HTTPS; sessions use httpOnly cookies; Gmail tokens are encrypted at rest; files
            are stored privately. Sending is capped per day and requires your review unless you turn on auto-send.
          </p>
        </Section>

        <Section title="Your responsibilities">
          <p>
            You are responsible for the emails you send and for complying with anti-spam laws and the terms of the
            platforms you take job posts from.
          </p>
        </Section>

        <Section title="Contact">
          <p>Questions or data requests: {CONTACT}.</p>
        </Section>
      </article>
    </main>
  );
}
