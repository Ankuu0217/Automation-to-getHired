import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

import { Nav } from '@/components/Nav';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { cn } from '@/lib/utils';

/*
 * Landing — "bioluminescent laboratory at midnight". Alternating
 * full-bleed bands: ink hero + method, bone platform + assurance,
 * ink close, void footer. Typography is the image: Aspekta 400,
 * hierarchy by size and tracking only.
 */

const reveal = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
  transition: { duration: 0.5, ease: 'easeOut' },
} as const;

const HERO_FACTS = [
  '≤ 180 WORDS PER EMAIL',
  '30 SENDS / DAY, CAPPED',
  'FOLLOW-UPS D+3 · D+7',
  'SENT FROM YOUR GMAIL',
] as const;

const METHOD = [
  {
    counter: '01 / CAPTURE',
    heading: 'Drop in a screenshot of any job post.',
    body: "Vision AI extracts the company, the role, the location, and the recruiter's address — with a confidence score on every field. Low confidence gets flagged, not guessed.",
  },
  {
    counter: '02 / COMPOSE',
    heading: 'An email written against your resume.',
    body: 'Match analysis scores the role from 0 to 100 against your skills and surfaces the gaps. The draft runs under 180 words, in your tone. Nothing sends without your approval.',
  },
  {
    counter: '03 / DISPATCH',
    heading: 'Sent from your Gmail. Not ours.',
    body: 'OAuth-connected sending with your resume attached. Addresses are MX-validated, timing is jittered, volume is capped — the guardrails that keep you out of the spam folder.',
  },
  {
    counter: '04 / TRACK',
    heading: 'The pipeline keeps the ledger.',
    body: 'Opens recorded to the minute. Follow-ups fire on day 3 and day 7, and stop the moment a reply lands. Fourteen days of silence marks it ghosted — recorded, not forgotten.',
  },
] as const;

const PLATFORM = [
  {
    heading: 'Match analysis.',
    body: 'A score against your profile before you spend a send. Below 40, the system tells you to think twice.',
  },
  {
    heading: 'Templates with evidence.',
    body: "Every template carries its own sent, opened, and replied counts. Keep what works. Retire what doesn't.",
  },
  {
    heading: 'Deliverability guardrails.',
    body: 'Daily caps, hourly throttles, two-to-eight-minute jitter, MX checks. Volume is easy. Landing in the primary tab is the discipline.',
  },
  {
    heading: 'A pipeline, not a spreadsheet.',
    body: 'Applied, opened, replied, interview, offer. Drag the cards, keep the notes, mark the replies — the whole search on one board.',
  },
] as const;

const ASSURANCES = [
  'YOUR GMAIL, YOUR DATA',
  'AES-256 TOKEN ENCRYPTION',
  'DELETE EVERYTHING, ANY TIME',
  'NO SEND WITHOUT APPROVAL',
] as const;

const MONO_13 = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em]';

function scrollToMethod() {
  document.getElementById('method')?.scrollIntoView({ behavior: 'smooth' });
}

export function Landing() {
  return (
    <div className="bg-ink font-sans text-paper">
      <Nav variant="public" />

      {/* BAND 1 — HERO */}
      <section className="relative flex min-h-[90vh] flex-col justify-end">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-16 pt-40">
          <p className={cn(MONO_13, 'flex items-center gap-3 text-text-2-dark')}>
            <span aria-hidden className="size-1.5 rounded-full bg-lime" />
            COLD OUTREACH, INSTRUMENTED
          </p>
          <h1 className="mt-10 text-[clamp(52px,9vw,111px)] font-normal leading-[1] tracking-[-0.02em] text-paper">
            From screenshot
            <br />
            to sent.
          </h1>
          <p className="mt-24 max-w-[560px] text-subheading font-normal text-text-2-dark lg:mt-40">
            GetHired reads a LinkedIn job post from a screenshot, writes a personalized email
            against your resume, and sends it from your own Gmail — capped, tracked, and followed
            up on schedule.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              to="/register"
              className={cn(
                MONO_13,
                'focus-ring inline-flex h-11 items-center rounded-btn bg-paper px-5 text-ink transition-quick hover:opacity-[0.92]',
              )}
            >
              Start applying
            </Link>
            <a
              href="#method"
              className={cn(
                MONO_13,
                'focus-ring inline-flex h-11 items-center rounded-btn border border-graphite px-5 text-paper transition-quick hover:border-text-3-dark hover:bg-paper/[0.04]',
              )}
            >
              See the method
            </a>
            <ArrowSquare decorative direction="down" onClick={scrollToMethod} />
          </div>
        </div>
        <div className="border-t border-graphite">
          <div
            className={cn(
              MONO_13,
              'mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-12 gap-y-2 px-6 py-5 text-text-2-dark',
            )}
          >
            {HERO_FACTS.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>
        </div>
      </section>

      {/* BAND 2 — THE METHOD */}
      <section id="method" className="scroll-mt-10">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          {METHOD.map((step, index) => (
            <motion.article
              key={step.counter}
              {...reveal}
              className={cn(
                'grid gap-6 border-t border-graphite py-16 md:grid-cols-[220px_1fr] md:py-24',
                index === 0 && 'border-t-0 pt-0',
              )}
            >
              <p>
                <span
                  className={cn(
                    MONO_13,
                    'inline-flex items-center rounded-pill border border-graphite px-3 py-1.5 text-text-2-dark',
                  )}
                >
                  {step.counter}
                </span>
              </p>
              <div>
                <h2 className="text-heading font-normal text-paper md:text-heading-lg">
                  {step.heading}
                </h2>
                <p className="mt-5 max-w-[520px] text-body-lg font-normal text-text-2-dark">
                  {step.body}
                </p>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* BAND 3 — THE PLATFORM (light flip) */}
      <section id="platform" className="bg-bone text-ink">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <p className={cn(MONO_13, 'flex items-center gap-3 text-graphite')}>
            <span aria-hidden className="size-1.5 rounded-full bg-lime" />
            THE PLATFORM
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {PLATFORM.map((card) => (
              <motion.div
                key={card.heading}
                {...reveal}
                className="flex flex-col justify-between rounded-card border border-lichen bg-paper p-10"
              >
                <div>
                  <h3 className="text-subheading font-normal text-ink">{card.heading}</h3>
                  <p className="mt-4 text-body-lg font-normal text-graphite">{card.body}</p>
                </div>
                <Link
                  to="/register"
                  className={cn(
                    MONO_13,
                    'focus-ring mt-8 inline-flex w-fit items-center gap-2 rounded-btn text-graphite transition-quick focus-visible:ring-ink focus-visible:ring-offset-paper hover:text-ink',
                  )}
                >
                  Explore
                  <span aria-hidden>→</span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* BAND 4 — ASSURANCE STRIP */}
      <section className="bg-bone text-ink">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-28">
          <div
            className={cn(
              MONO_13,
              'flex flex-wrap items-center gap-x-12 gap-y-3 rounded-card border border-lichen px-8 py-6 text-graphite',
            )}
          >
            {ASSURANCES.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      </section>

      {/* BAND 5 — CLOSE */}
      <section>
        <div className="mx-auto w-full max-w-[1200px] px-6 py-32">
          <motion.div {...reveal}>
            <h2 className="max-w-[900px] text-display-sm font-normal text-paper lg:text-display">
              Your next role is one send away.
            </h2>
            <div className="mt-12 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className={cn(
                  MONO_13,
                  'focus-ring inline-flex h-11 items-center rounded-btn bg-paper px-5 text-ink transition-quick hover:opacity-[0.92]',
                )}
              >
                Start applying
              </Link>
              <ArrowSquare decorative to="/register" />
            </div>
            <p className={cn(MONO_13, 'mt-10 text-text-2-dark')}>
              FREE WHILE IN BETA — GMAIL CONNECT TAKES TWO MINUTES.
            </p>
          </motion.div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-void">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-6 px-6 py-12">
          <span className="font-sans text-subheading font-normal leading-none text-paper">
            GetHired
          </span>
          <nav aria-label="Footer" className={cn(MONO_13, 'flex flex-wrap items-center gap-6')}>
            <a href="#method" className="focus-ring rounded-btn text-text-2-dark transition-quick hover:text-paper">
              Method
            </a>
            <a href="#platform" className="focus-ring rounded-btn text-text-2-dark transition-quick hover:text-paper">
              Platform
            </a>
            <Link to="/login" className="focus-ring rounded-btn text-text-2-dark transition-quick hover:text-paper">
              Log in
            </Link>
            <Link to="/register" className="focus-ring rounded-btn text-text-2-dark transition-quick hover:text-paper">
              Register
            </Link>
          </nav>
          <span className={cn(MONO_13, 'text-text-3-dark')}>BUILT QUIETLY — GETHIRED © 2026</span>
        </div>
      </footer>
    </div>
  );
}
