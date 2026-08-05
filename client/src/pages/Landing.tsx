import { motion, useReducedMotion } from 'framer-motion';
import Lenis from 'lenis';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { ArrowSquare } from '@/components/ui/arrow-square';
import { cn } from '@/lib/utils';

/*
 * Landing — image-rich editorial landing in the laboratory language:
 * floating frosted pill nav over a full-bleed organic hero, ink bands
 * hugging text left, a bone-white "how it works" flip, pure-black
 * footer. Single-weight Aspekta; Roboto Mono for anything technical;
 * lime only at micro-scale. Motion is calm fade-rise, once per element.
 */

const MONO_13 = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em]';

const EASE = [0.16, 1, 0.3, 1] as const;

const PILLARS = [
  {
    index: '01 CAPTURE',
    title: 'Read any job post.',
    body: 'Vision AI pulls the company, role, location, and recruiter address from a screenshot, with a confidence score on every field. Low confidence is flagged, never guessed.',
  },
  {
    index: '02 COMPOSE',
    title: 'Written against your resume.',
    body: 'Match analysis scores the role 0–100 against your skills and surfaces the gaps. The draft stays under 180 words, in your tone. Nothing sends without your approval.',
  },
  {
    index: '03 DISPATCH',
    title: 'Sent from your Gmail.',
    body: 'OAuth sending with your resume attached, addresses MX-checked, timing jittered, volume capped. Follow-ups fire on day 3 and day 7 and stop the moment a reply lands.',
  },
] as const;

const STEPS = [
  {
    tag: 'STEP 01',
    title: 'Connect Gmail.',
    body: 'Two-minute OAuth. GetHired only ever sends as you — tokens are AES-256 encrypted and revocable.',
  },
  {
    tag: 'STEP 02',
    title: 'Drop a screenshot.',
    body: 'Any LinkedIn or job-board post. Confirm the recruiter address the AI found, edit if needed.',
  },
  {
    tag: 'STEP 03',
    title: 'Approve the draft.',
    body: 'Read the match score, tune the tone, edit a line. You are always the last check before send.',
  },
  {
    tag: 'STEP 04',
    title: 'Watch the pipeline.',
    body: 'Opens, replies, follow-ups, ghosted flags — the whole search on one board.',
  },
] as const;

const NAV_LINKS = [
  { label: 'Platform', hash: '#platform' },
  { label: 'Company', hash: '#company' },
  { label: 'How it works', hash: '#how' },
] as const;

/** Original thin-line loop mark for the wordmark. */
function LoopMark() {
  return (
    <svg
      viewBox="0 0 28 16"
      aria-hidden
      className="h-4 w-7 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M14 8 C 11 2.5, 3 2.5, 3 8 C 3 13.5, 11 13.5, 14 8 C 17 2.5, 25 2.5, 25 8 C 25 13.5, 17 13.5, 14 8 Z" />
    </svg>
  );
}

export function Landing() {
  const reduce = useReducedMotion();
  const lenisRef = useRef<Lenis | null>(null);
  const [heroImageOk, setHeroImageOk] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ autoRaf: true });
    lenisRef.current = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  const scrollToHash = (hash: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const el = document.querySelector(hash) as HTMLElement | null;
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el, { offset: -16 });
    else el.scrollIntoView({ behavior: 'smooth' });
  };

  /* Fade-rise reveal; renders at final state when motion is reduced. */
  const reveal = reduce
    ? {}
    : ({
        initial: { opacity: 0, y: 24 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: '-15%' },
        transition: { duration: 0.6, ease: EASE },
      } as const);

  const stagger = reduce
    ? { parent: {}, child: {} }
    : {
        parent: {
          initial: 'hidden',
          whileInView: 'show',
          viewport: { once: true, margin: '-15%' },
          variants: { show: { transition: { staggerChildren: 0.08 } } },
        },
        child: {
          variants: {
            hidden: { opacity: 0, y: 24 },
            show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
          },
        },
      };

  const pillLink = cn(
    MONO_13,
    'focus-ring hidden rounded-nav px-3 py-2 text-graphite transition-quick focus-visible:ring-ink focus-visible:ring-offset-bone hover:bg-ink/[0.06] hover:text-ink md:inline-block',
  );

  return (
    <div className="bg-ink font-sans text-paper">
      {/* Floating pill nav over the hero */}
      <header className="absolute inset-x-0 top-6 z-40">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-6">
          <Link to="/" aria-label="GetHired home" className="focus-ring flex items-center gap-2.5 rounded-btn text-paper">
            <LoopMark />
            <span className="text-subheading font-normal leading-none">GetHired</span>
          </Link>
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 rounded-nav border border-lichen bg-bone/70 p-1.5 backdrop-blur-[12px]"
          >
            {NAV_LINKS.map((link) => (
              <a key={link.hash} href={link.hash} onClick={scrollToHash(link.hash)} className={pillLink}>
                {link.label}
              </a>
            ))}
            <Link
              to="/register"
              className={cn(
                MONO_13,
                'focus-ring inline-flex h-9 items-center rounded-btn bg-ink px-4 text-paper transition-quick focus-visible:ring-ink focus-visible:ring-offset-bone hover:opacity-[0.92]',
              )}
            >
              Start applying
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO — full-bleed organic render over the animated mesh fallback */}
      <section className="hero-mesh relative flex min-h-[92vh] flex-col">
        {heroImageOk && (
          <img
            src="/hero/render.svg"
            alt=""
            aria-hidden
            onError={() => setHeroImageOk(false)}
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {/* scrim keeps the headline and subtext legible over the render */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,rgba(15,20,18,0.75),transparent_55%)]"
        />

        <div className="relative mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-between px-6 pb-14 pt-36">
          <div>
            <motion.p
              {...(reduce
                ? {}
                : {
                    initial: { opacity: 0, y: 24 },
                    animate: { opacity: 1, y: 0 },
                    transition: { duration: 0.6, ease: EASE },
                  })}
              className={cn(MONO_13, 'flex items-center gap-3 text-paper')}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-lime" />
              COLD OUTREACH, INSTRUMENTED
            </motion.p>
            {/* clamp floor adapted 72 -> 56 so "screenshot" never breaks at 390px */}
            <motion.h1
              {...(reduce
                ? {}
                : {
                    initial: { opacity: 0, y: 24 },
                    animate: { opacity: 1, y: 0 },
                    transition: { duration: 0.7, ease: EASE, delay: 0.08 },
                  })}
              className="mt-8 text-[clamp(56px,9.5vw,128px)] font-normal leading-[1.02] tracking-[-0.02em] text-paper"
            >
              From screenshot
              <br />
              to sent.
            </motion.h1>
          </div>

          <div className="mt-16 flex flex-wrap items-end justify-between gap-8">
            <p className="max-w-[520px] text-body-xl font-normal text-bone">
              We read a job post from a screenshot, write a personalized email against your resume,
              and send it from your own Gmail — capped, tracked, and followed up on schedule.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="#platform"
                onClick={scrollToHash('#platform')}
                className={cn(
                  MONO_13,
                  'focus-ring inline-flex h-11 items-center rounded-btn bg-ink px-4 text-paper transition-quick hover:opacity-[0.92]',
                )}
              >
                Discover the method
              </a>
              <ArrowSquare size="lg" decorative onClick={scrollToHash('#platform')} />
            </div>
          </div>
        </div>
      </section>

      {/* BAND 01 — WHAT WE DO */}
      <section>
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <motion.div {...reveal}>
            <span
              className={cn(
                MONO_13,
                'inline-flex items-center rounded-pill border border-graphite px-3 py-1.5 text-text-2-dark',
              )}
            >
              01 / 03
            </span>
            <p className="mt-10 max-w-[720px] text-heading-lg font-normal text-text-2-dark">
              A job search is a systems problem — dozens of roles, dozens of recruiters, every
              message personal. GetHired is built to run that pipeline without losing the human in
              it.
            </p>
          </motion.div>
        </div>
      </section>

      {/* BAND 02 — THE PLATFORM */}
      <section id="platform" className="scroll-mt-8">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <motion.div {...reveal}>
            <h2 className="max-w-[900px] text-display-sm font-normal text-paper">
              Screenshots in. Personalized, tracked outreach out.
            </h2>
            <p className="mt-6 max-w-[620px] text-body-xl font-normal text-text-2-dark">
              The platform turns a screenshot into a sent, tracked email — with the guardrails that
              keep you in the primary inbox.
            </p>
          </motion.div>

          <motion.div {...stagger.parent} className="mt-16">
            {PILLARS.map((pillar) => (
              <motion.div
                key={pillar.index}
                {...stagger.child}
                className="grid gap-6 border-t border-graphite py-12 md:grid-cols-[160px_1fr_auto] md:items-start"
              >
                <span className={cn(MONO_13, 'text-text-2-dark')}>{pillar.index}</span>
                <div>
                  <h3 className="text-subheading font-normal text-paper">{pillar.title}</h3>
                  <p className="mt-3 max-w-[520px] text-body-lg font-normal text-text-2-dark">
                    {pillar.body}
                  </p>
                </div>
                <ArrowSquare decorative className="justify-self-start md:justify-self-end" />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* BAND 03 — COMPANY */}
      <section id="company" className="scroll-mt-8">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <motion.div {...reveal}>
            <span
              className={cn(
                MONO_13,
                'inline-flex items-center rounded-pill border border-graphite px-3 py-1.5 text-text-2-dark',
              )}
            >
              02 / 03
            </span>
            <h2 className="mt-10 max-w-[820px] text-display-sm font-normal text-paper">
              Built for the search, not the spray.
            </h2>
            <p className="mt-6 max-w-[640px] text-body-xl font-normal text-text-2-dark">
              Mass senders get you filtered. GetHired is deliberately capped and personal — every
              email earns its place in someone's inbox. Your Gmail, your data, deletable in full at
              any time.
            </p>
            <a
              href="#how"
              onClick={scrollToHash('#how')}
              className={cn(
                MONO_13,
                'focus-ring group mt-10 inline-flex h-11 items-center gap-2 rounded-btn border border-graphite px-4 text-paper transition-quick hover:border-text-3-dark hover:bg-paper/[0.04]',
              )}
            >
              Learn the guardrails
              <span aria-hidden className="transition-transform duration-200 ease-out group-hover:translate-x-0.5">
                →
              </span>
            </a>
          </motion.div>
        </div>
      </section>

      {/* BAND 04 — HOW IT WORKS (bone flip) */}
      <section id="how" className="scroll-mt-8 bg-bone text-ink">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <motion.p {...reveal} className={cn(MONO_13, 'flex items-center gap-3 text-graphite')}>
            <span aria-hidden className="size-1.5 rounded-full bg-lime" />
            HOW IT WORKS
          </motion.p>
          <motion.div {...stagger.parent} className="mt-12 grid gap-6 md:grid-cols-2">
            {STEPS.map((step) => (
              <motion.article
                key={step.tag}
                {...stagger.child}
                className="flex flex-col rounded-card border border-lichen bg-paper p-10"
              >
                <span className={cn(MONO_13, 'text-graphite')}>{step.tag}</span>
                <h3 className="mt-6 text-heading font-normal text-ink">{step.title}</h3>
                <p className="mt-4 max-w-[440px] text-body-lg font-normal text-graphite">
                  {step.body}
                </p>
                <span aria-hidden className={cn(MONO_13, 'mt-8 text-graphite')}>
                  NEXT →
                </span>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      {/* BAND 05 — CLOSE */}
      <section>
        <div className="mx-auto w-full max-w-[1200px] px-6 py-32">
          <motion.div {...reveal}>
            <h2 className="max-w-[900px] text-display font-normal text-paper">
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
              <ArrowSquare size="lg" decorative to="/register" />
            </div>
            <p className={cn(MONO_13, 'mt-10 text-text-2-dark')}>
              FREE WHILE IN BETA · GMAIL CONNECT TAKES TWO MINUTES.
            </p>
          </motion.div>
        </div>
      </section>

      {/* FOOTER — the only pure-black surface */}
      <footer className="bg-void">
        <div className="mx-auto w-full max-w-[1200px] px-6 py-14">
          <div className="flex flex-wrap items-start justify-between gap-10">
            <div>
              <span className="flex items-center gap-2.5 text-subheading font-normal leading-none text-paper">
                <LoopMark />
                GetHired
              </span>
              <p className="mt-4 max-w-[360px] text-body-xl font-normal text-text-2-dark">
                Personalized job outreach, instrumented.
              </p>
            </div>
            <nav aria-label="Footer" className={cn(MONO_13, 'flex flex-wrap items-center gap-6')}>
              {NAV_LINKS.map((link) => (
                <a
                  key={link.hash}
                  href={link.hash}
                  onClick={scrollToHash(link.hash)}
                  className="focus-ring rounded-btn text-text-2-dark transition-quick focus-visible:ring-offset-void hover:text-paper"
                >
                  {link.label}
                </a>
              ))}
              <Link
                to="/login"
                className="focus-ring rounded-btn text-text-2-dark transition-quick focus-visible:ring-offset-void hover:text-paper"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="focus-ring rounded-btn text-text-2-dark transition-quick focus-visible:ring-offset-void hover:text-paper"
              >
                Register
              </Link>
            </nav>
          </div>
          <div
            className={cn(
              MONO_13,
              'mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-graphite pt-6 text-text-3-dark',
            )}
          >
            <span>BUILT QUIETLY — GETHIRED © 2026</span>
            {/* TODO(social): wire real profiles when they exist */}
            <span>LINKEDIN · X</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
