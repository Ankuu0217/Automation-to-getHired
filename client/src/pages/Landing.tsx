import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import Lenis from 'lenis';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { HeroMedia } from '@/components/HeroMedia';
import { FeatureShowcase } from '@/components/landing/FeatureShowcase';
import { PlatformBlocks } from '@/components/landing/PlatformBlocks';
import { BoyBall } from '@/components/landing/BoyBall';
import { ReadingBird } from '@/components/landing/ReadingBird';
import { WalkingCrab } from '@/components/landing/WalkingCrab';
import { SiteFooter } from '@/components/landing/SiteFooter';
import { ArrowSquare } from '@/components/ui/arrow-square';
import { heroIntroPending, markHeroIntroPlayed } from '@/lib/heroIntro';
import { cn } from '@/lib/utils';

/*
 * Landing — image-rich editorial landing in the laboratory language:
 * floating frosted pill nav over a full-bleed underwater VIDEO hero, ink
 * bands hugging text left, a bone-white "how it works" flip, pure-black
 * footer. Single-weight Aspekta; Roboto Mono for anything technical; lime
 * only at micro-scale.
 *
 * Motion is one vocabulary. Smoothness comes from never software-painting a
 * full-bleed surface during scroll: the hero is a GPU-decoded <video> and
 * every scroll-linked value is derived from Lenis's own scroll callback (no
 * second scroll listener, no per-frame canvas). See docs/HERO_MOTION.md.
 */

const MONO_13 = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em] tabular-nums';

const EASE = [0.16, 1, 0.3, 1] as const;
const SPRING = { stiffness: 120, damping: 26, mass: 0.4 } as const;

/* One inversion grammar for the primary CTAs — bg + colour only, expo-out.
   Uses arbitrary transition-duration / transition-timing-function *properties*
   rather than the shorthand duration/ease scales, whose tailwindcss-animate
   duplicates would make an arbitrary value ambiguous and silently drop it. */
const CTA_INVERT =
  'transition-[background-color,color] [transition-duration:320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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
  const heroRef = useRef<HTMLElement | null>(null);
  const heroH = useRef(typeof window !== 'undefined' ? window.innerHeight : 800);

  const [intro] = useState(() => heroIntroPending());
  const [mediaRevealing, setMediaRevealing] = useState(intro);
  const [scrolled, setScrolled] = useState(false);
  const [showLight, setShowLight] = useState(false);
  const [birdSvg, setBirdSvg] = useState<string | null>(null);
  const [crabSvg, setCrabSvg] = useState<string | null>(null);
  const [boySvg, setBoySvg] = useState<string | null>(null);

  /* Single scroll source. When motion is allowed, Lenis owns the one rAF loop
     and we read its smoothed scroll from its own callback (no framer useScroll,
     no second listener). Under reduced motion Lenis is off; a passive native
     listener still drives the nav condense (a colour change, not motion). */
  const scrollMV = useMotionValue(0);
  useEffect(() => {
    const onCross = (y: number) => setScrolled(y > 48);
    if (reduce) {
      const onScroll = () => onCross(window.scrollY);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => window.removeEventListener('scroll', onScroll);
    }
    const lenis = new Lenis({ autoRaf: true });
    lenisRef.current = lenis;
    const cb = (e: { scroll: number }) => {
      const s = e.scroll ?? window.scrollY;
      scrollMV.set(s);
      onCross(s);
    };
    lenis.on('scroll', cb);
    return () => {
      lenis.off('scroll', cb);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduce, scrollMV]);

  /* Keep the hero height current for progress mapping. */
  useEffect(() => {
    const set = () => {
      heroH.current = heroRef.current?.offsetHeight || window.innerHeight;
    };
    set();
    window.addEventListener('resize', set);
    return () => window.removeEventListener('resize', set);
  }, []);

  /* Hero parallax — spring the normalized progress once, derive clamped
     transforms from the smoothed driver so a trackpad flick never snaps. */
  const prog = useSpring(
    useTransform(scrollMV, (s) => clamp01(s / heroH.current)),
    SPRING,
  );
  const videoY = useTransform(prog, [0, 0.6], ['0%', '-6%'], { clamp: true });
  const videoScale = useTransform(prog, [0, 0.6], [1, 1.06], { clamp: true });
  const headlineY = useTransform(prog, [0, 0.5], [0, -32], { clamp: true });
  const headlineOpacity = useTransform(prog, [0, 0.5], [1, 0], { clamp: true });

  /* Cursor-follow light — framer spring smooths toward the pointer (settles and
     stops; no perpetual rAF). Desktop hover only. */
  const cursorX = useMotionValue(-400);
  const cursorY = useMotionValue(-400);
  const lightX = useSpring(cursorX, { stiffness: 140, damping: 26, mass: 0.4 });
  const lightY = useSpring(cursorY, { stiffness: 140, damping: 26, mass: 0.4 });
  useEffect(() => {
    if (reduce || !window.matchMedia('(hover: hover)').matches) return;
    const el = heroRef.current;
    if (!el) return;
    setShowLight(true);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      cursorX.set(e.clientX - r.left);
      cursorY.set(e.clientY - r.top);
    };
    el.addEventListener('pointermove', onMove);
    return () => {
      el.removeEventListener('pointermove', onMove);
      setShowLight(false);
    };
  }, [reduce, cursorX, cursorY]);

  /* Lock scroll during the load intro so nobody scrolls mid-sequence; release
     once the media (the last element) has revealed. */
  useEffect(() => {
    if (!intro || reduce) return;
    markHeroIntroPlayed();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Lenis owns the scroll loop, so overflow:hidden alone won't stop it.
    lenisRef.current?.stop();
    const release = () => {
      document.body.style.overflow = prev;
      lenisRef.current?.start();
    };
    const t = window.setTimeout(release, 2400);
    return () => {
      window.clearTimeout(t);
      release();
    };
  }, [intro, reduce]);

  /* Fetch the decorative bird SVG once and inline it — an <object> renders it on
     Chrome's white document canvas, whereas inlining honours its transparency
     (and keeps the 200KB asset out of the JS bundle). SMIL still loops inline. */
  useEffect(() => {
    let alive = true;
    // The seam crab is inlined in ALL cases — under reduced motion WalkingCrab
    // freezes its SMIL (an <img> keeps walking in Chrome), so it still needs the
    // markup. The bird stays motion-gated (it's a hover toy).
    fetch('/media/walking-crab.svg')
      .then((r) => r.text())
      .then((t) => {
        if (alive) setCrabSvg(t);
      })
      .catch(() => {});
    // The boy who sits on the "S" — inlined so his SMIL throw runs (frozen under
    // reduced motion by the component itself).
    fetch('/media/boy-ball.svg')
      .then((r) => r.text())
      .then((t) => {
        if (alive) setBoySvg(t);
      })
      .catch(() => {});
    if (!reduce) {
      fetch('/media/reading-book.svg')
        .then((r) => r.text())
        .then((t) => {
          if (alive) setBirdSvg(t);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [reduce]);

  const scrollToHash = (hash: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const el = document.querySelector(hash) as HTMLElement | null;
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el, { offset: -16 });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  const scrollToTop = () => {
    if (lenisRef.current) lenisRef.current.scrollTo(0);
    else window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  /* Hero copy fade-rise; when the intro plays, delays follow the timing table
     (see docs/HERO_MOTION.md), otherwise everything rises immediately. */
  const rise = (delay: number, duration = 0.6, y = 24) =>
    reduce
      ? {}
      : ({
          initial: { opacity: 0, y },
          animate: { opacity: 1, y: 0 },
          transition: { duration, ease: EASE, delay: intro ? delay : 0 },
        } as const);

  const navRise = reduce
    ? {}
    : ({
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: EASE, delay: intro ? 0.85 : 0 },
      } as const);

  /* Section reveals reuse the hero's mask language: a bottom-up clip wipe. */
  const reveal = reduce
    ? {}
    : ({
        initial: { opacity: 0, y: 16, clipPath: 'inset(0% 0% 100% 0%)' },
        whileInView: { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)' },
        viewport: { once: true, margin: '-12%' },
        transition: { duration: 0.7, ease: EASE },
      } as const);

  // Clip-free twin of `reveal` for the band that hosts the boy on the "S": he
  // sits at top:-161px, ABOVE the wrapper box, and reveal's lingering
  // clipPath:inset(0) would guillotine him (and his ball arc). Same fade+rise,
  // no clip — the rise doubles as his gentle settle onto the letter.
  const revealSoft = reduce
    ? {}
    : ({
        initial: { opacity: 0, y: 16 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, margin: '-12%' },
        transition: { duration: 0.7, ease: EASE },
      } as const);

  const stagger = reduce
    ? { parent: {}, child: {} }
    : {
        parent: {
          initial: 'hidden',
          whileInView: 'show',
          viewport: { once: true, margin: '-12%' },
          variants: { show: { transition: { staggerChildren: 0.08 } } },
        },
        child: {
          variants: {
            hidden: { opacity: 0, y: 16, clipPath: 'inset(0% 0% 100% 0%)' },
            show: {
              opacity: 1,
              y: 0,
              clipPath: 'inset(0% 0% 0% 0%)',
              transition: { duration: 0.7, ease: EASE },
            },
          },
        },
      };

  const pillLink = cn(
    MONO_13,
    'focus-ring hidden rounded-nav px-3 py-2 text-graphite transition-quick focus-visible:ring-ink focus-visible:ring-offset-bone hover:bg-ink/[0.06] hover:text-ink md:inline-block',
  );

  return (
    // overflow-x-clip (not hidden) guarantees no horizontal scrollbar from the
    // hero parallax scale / full-bleed blocks, without creating a scroll
    // container that would trap Lenis or sticky positioning.
    <div className="overflow-x-clip bg-ink font-sans text-paper">
      {/* Skip past the decorative hero media straight to the headline. */}
      <a
        href="#main"
        className="focus-ring sr-only rounded-btn bg-lime px-4 py-2 text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200]"
      >
        Skip to content
      </a>

      {/* Floating pill nav over the hero */}
      <motion.header {...navRise} className="absolute inset-x-0 top-6 z-40">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-6">
          <Link to="/" aria-label="GetHired home" className="focus-ring flex items-center gap-2.5 rounded-btn text-paper">
            <LoopMark />
            <span className="text-subheading font-normal leading-none">GetHired</span>
          </Link>
          <nav
            aria-label="Primary"
            className={cn(
              // padding stays constant — animating it would be layout-triggering;
              // the condense reads through background + blur + the hairline only.
              'flex items-center gap-1 rounded-nav border border-lichen p-1.5 transition-[background-color,backdrop-filter] [transition-duration:250ms]',
              scrolled ? 'bg-bone/[0.92] backdrop-blur-none' : 'bg-bone/70 backdrop-blur-[12px]',
            )}
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
                CTA_INVERT,
                'focus-ring inline-flex h-9 items-center rounded-btn bg-lime px-4 text-ink focus-visible:bg-ink focus-visible:text-lime focus-visible:ring-ink focus-visible:ring-offset-bone hover-hover:hover:bg-ink hover-hover:hover:text-lime',
              )}
            >
              Start applying
            </Link>
          </nav>
        </div>
      </motion.header>

      {/* HERO — full-bleed underwater video over the static mesh; media reveals last */}
      <section
        ref={heroRef}
        id="main"
        tabIndex={-1}
        className="hero-mesh relative flex min-h-[92vh] flex-col focus:outline-none"
      >
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={reduce ? undefined : { y: videoY, scale: videoScale }}
        >
          <motion.div
            className={cn('absolute inset-0', mediaRevealing && '[will-change:clip-path,transform,opacity]')}
            initial={
              reduce
                ? { opacity: 0 }
                : intro
                  ? { clipPath: 'inset(0% 0% 100% 0%)', scale: 1.08, opacity: 0 }
                  : false
            }
            animate={
              reduce
                ? { opacity: 1 }
                : { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, opacity: 1 }
            }
            transition={
              reduce
                ? { duration: 0.2 }
                : { delay: intro ? 1.35 : 0, duration: intro ? 0.9 : 0.001, ease: EASE }
            }
            onAnimationComplete={() => setMediaRevealing(false)}
          >
            <HeroMedia reduce={!!reduce} />
          </motion.div>
        </motion.div>

        {showLight && (
          <motion.div
            aria-hidden
            className="hero-cursor-light pointer-events-none absolute left-0 top-0 z-[1]"
            style={{ x: lightX, y: lightY }}
          />
        )}

        <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-1 flex-col justify-between px-6 pb-14 pt-36">
          <motion.div style={reduce ? undefined : { y: headlineY, opacity: headlineOpacity }}>
            <motion.p {...rise(0.55, 0.6, 20)} className={cn(MONO_13, 'flex items-center gap-3 text-paper')}>
              <span aria-hidden className="size-1.5 rounded-full bg-lime" />
              COLD OUTREACH, INSTRUMENTED
            </motion.p>
            {/* clamp floor adapted 72 -> 56 so "screenshot" never breaks at 390px */}
            <h1 className="mt-8 text-balance text-[clamp(56px,9.5vw,128px)] font-normal leading-[1.02] tracking-h1 text-paper">
              <motion.span {...rise(0.15, 0.7, 28)} className="block">
                From screenshot
              </motion.span>
              <motion.span {...rise(0.24, 0.7, 28)} className="block">
                to sent.
              </motion.span>
            </h1>
          </motion.div>

          <div className="mt-16 flex flex-wrap items-end justify-between gap-8">
            <motion.p
              {...rise(1.1, 0.6)}
              className="max-w-[520px] text-pretty text-body-xl font-normal tracking-copy text-bone"
            >
              We read a job post from a screenshot or pasted text, write a personalized email
              against your resume, and send it from your own Gmail — capped, tracked, and followed
              up on schedule.
            </motion.p>
            <motion.div {...rise(1.19, 0.6)} className="flex items-center gap-3">
              <div className="group/cta inline-flex items-center gap-3 rounded-btn transition-transform [transition-duration:120ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover-hover:hover:-translate-y-px active:translate-y-0">
                <a
                  href="#platform"
                  onClick={scrollToHash('#platform')}
                  className={cn(
                    MONO_13,
                    CTA_INVERT,
                    'focus-ring inline-flex h-11 items-center rounded-btn bg-lime px-4 text-ink focus-visible:ring-ink focus-visible:ring-offset-bone group-focus-within/cta:bg-ink group-focus-within/cta:text-lime hover-hover:group-hover/cta:bg-ink hover-hover:group-hover/cta:text-lime',
                  )}
                >
                  Discover the method
                </a>
                <ArrowSquare size="lg" variant="inverted" decorative onClick={scrollToHash('#platform')} />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* BAND 01 — WHAT WE DO */}
      {/* cv-auto omitted: it sits above the #platform/#company/#how scroll
          targets, so its intrinsic size would skew their Lenis scrollTo offset. */}
      <section>
        <div className="mx-auto w-full max-w-[1200px] px-6 py-28">
          <div className="grid items-center gap-10 md:grid-cols-[1fr_auto]">
            <motion.div {...reveal}>
              <span
                className={cn(
                  MONO_13,
                  'inline-flex items-center rounded-pill border border-graphite px-3 py-1.5 text-text-2-dark',
                )}
              >
                01 / 02
              </span>
              <p className="mt-10 max-w-[640px] text-balance text-heading-lg font-normal tracking-h3 text-text-2-dark">
                A job search is a systems problem — dozens of roles, dozens of recruiters, every
                message personal. GetHired is built to run that pipeline without losing the human in
                it.
              </p>
            </motion.div>
            {/* Decorative reading-bird — animated SVG, slides in slow + smooth
                from the right. Reduced motion gets a still <img> and no slide. */}
            <motion.div
              aria-hidden
              {...(reduce
                ? ({
                    initial: { opacity: 0 },
                    whileInView: { opacity: 1 },
                    viewport: { once: true, margin: '-15%' },
                    transition: { duration: 0.2 },
                  } as const)
                : ({
                    initial: { opacity: 0, x: 150 },
                    whileInView: { opacity: 1, x: 0 },
                    viewport: { once: true, margin: '-15%' },
                    transition: { duration: 1.9, ease: EASE },
                  } as const))}
              className="justify-self-center [perspective:900px] md:justify-self-end"
            >
              {reduce ? (
                // Reduced motion: a still <img> (renders transparent, no SMIL).
                <img
                  src="/media/reading-book.svg"
                  alt=""
                  aria-hidden
                  className="pointer-events-none block size-[clamp(300px,34vw,460px)]"
                />
              ) : (
                // Animated bird + desktop "curious peek" pointer-follow.
                <ReadingBird birdSvg={birdSvg} />
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* BAND 02 — THE PLATFORM (intro + full-bleed feature blocks) */}
      {/* cv-auto intentionally omitted: this and #company/#how are Lenis
          scrollTo targets, and cv-auto's intrinsic sizing shifts the landing. */}
      <section id="platform" className="scroll-mt-8">
        <div className="mx-auto w-full max-w-[1200px] px-6 pb-14 pt-28">
          <motion.div {...revealSoft}>
            <h2 className="ml-auto max-w-[900px] text-balance text-right text-display-sm font-normal tracking-h2 text-paper">
              {/* The boy rides the "S": wrap it so `left:50%` is the letter's own
                  centre — he stays seated as the right-aligned heading re-wraps. */}
              <span className="relative">
                S<BoyBall boySvg={boySvg} />
              </span>
              creenshots in. Personalized, tracked outreach out.
            </h2>
            <p className="ml-auto mt-6 max-w-[620px] text-pretty text-right text-body-xl font-normal tracking-copy text-text-2-dark">
              The platform turns a screenshot into a sent, tracked email — with the guardrails that
              keep you in the primary inbox.
            </p>
          </motion.div>
        </div>
        <PlatformBlocks reduce={reduce} />
      </section>

      {/* FEATURES — everything after the send */}
      <FeatureShowcase reduce={reduce} />

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
              02 / 02
            </span>
            <h2 className="mt-10 max-w-[820px] text-balance text-display-sm font-normal tracking-h2 text-paper">
              Built for the search, not the spray.
            </h2>
            <p className="mt-6 max-w-[640px] text-pretty text-body-xl font-normal tracking-copy text-text-2-dark">
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

      {/* BAND 04 — HOW IT WORKS (bone flip); tucks under the footer's rounded top */}
      <section id="how" className="relative scroll-mt-8 bg-bone text-ink">
        {/* Decorative crab patrolling the dark→light seam (this section's top
            edge), across the right half. Handles reduced motion internally. */}
        <WalkingCrab crabSvg={crabSvg} />
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
                className="group flex flex-col rounded-card border border-lichen bg-paper p-10"
              >
                <span className={cn(MONO_13, 'text-graphite')}>{step.tag}</span>
                {/* hover: title underlines + the NEXT arrow changes colour
                    (integratedbio card grammar). */}
                <h3 className="mt-6 text-balance text-heading font-normal tracking-h3 text-ink decoration-1 underline-offset-[6px] group-hover:underline">
                  {step.title}
                </h3>
                <p className="mt-4 max-w-[440px] text-pretty text-body-lg font-normal tracking-copy text-graphite">
                  {step.body}
                </p>
                <span aria-hidden className={cn(MONO_13, 'mt-8 text-graphite transition-colors group-hover:text-ink')}>
                  NEXT →
                </span>
              </motion.article>
            ))}
          </motion.div>
        </div>
      </section>

      {/* FOOTER — cinematic close (absorbs the former BAND 05 close copy) */}
      <SiteFooter reduce={reduce} onNavClick={scrollToHash} onScrollTop={scrollToTop} />
    </div>
  );
}
