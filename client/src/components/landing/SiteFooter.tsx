import { motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ArrowSquare } from '@/components/ui/arrow-square';
import { cn } from '@/lib/utils';

/*
 * Cinematic footer — a full-bleed poster panel (the hero still, same brand
 * stack, NO second video) with the closing line + inverted CTA, two link
 * columns, a scroll-to-top control, and a hero-scale GetHired wordmark bleeding
 * off the bottom. The panel's rounded top tucks the bone section above it in.
 * The close copy is relocated here (not rewritten).
 *
 * Motion: one parent observer on the content column (fires when the footer's
 * TOP enters — reliable in every browser) staggers every child, so the wordmark
 * (last, clip-reveal) can never be stranded invisible by a bottom-anchored
 * observer that fails to fire.
 */

const MONO = 'font-mono text-[13px] font-normal uppercase tracking-[-0.02em] tabular-nums';
const EASE = [0.16, 1, 0.3, 1] as const;

const CTA_INVERT =
  'transition-[background-color,color] [transition-duration:320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]';

const NAV = [
  { label: 'Platform', hash: '#platform' },
  { label: 'Company', hash: '#company' },
  { label: 'How it works', hash: '#how' },
] as const;

interface SiteFooterProps {
  reduce: boolean | null;
  onNavClick: (hash: string) => (event: React.MouseEvent) => void;
  onScrollTop: () => void;
}

export function SiteFooter({ reduce, onNavClick, onScrollTop }: SiteFooterProps) {
  const on = !reduce;
  const parent = on
    ? ({
        initial: 'hidden',
        whileInView: 'show',
        viewport: { once: true, amount: 0 },
        variants: { show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } },
      } as const)
    : {};
  const item = on
    ? ({
        variants: {
          hidden: { opacity: 0, y: 20 },
          show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
        },
      } as const)
    : {};
  const wordItem = on
    ? ({
        variants: {
          hidden: { opacity: 0, y: 24, clipPath: 'inset(0 0 100% 0)' },
          show: {
            opacity: 1,
            y: 0,
            clipPath: 'inset(0 0 0 0)',
            transition: { duration: 0.9, ease: EASE },
          },
        },
      } as const)
    : {};

  const footLink = 'focus-ring rounded-btn text-paper/90 transition-colors hover:text-paper';

  return (
    <footer className="cv-auto relative -mt-6 overflow-hidden rounded-t-card-lg bg-void">
      {/* poster panel — static still, same brand stack as the hero */}
      <div aria-hidden className="absolute inset-0">
        <img
          src="/hero/underwater-poster.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="hero-video size-full object-cover"
        />
        <div className="absolute inset-0 bg-ink/[0.45]" />
        <div className="footer-scrim absolute inset-0" />
      </div>

      <motion.div {...parent} className="relative flex min-h-[78vh] flex-col pt-24">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-start justify-between gap-12 px-6">
          {/* left: the closing line + inverted CTA cluster */}
          <motion.div {...item} className="max-w-[560px]">
            <h2 className="text-balance text-display-sm font-normal tracking-h2 text-paper">
              Your next role is one send away.
            </h2>
            <div className="mt-10 flex items-center gap-3">
              <div className="group/cta inline-flex items-center gap-3 rounded-btn transition-transform [transition-duration:120ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover-hover:hover:-translate-y-px active:translate-y-0">
                <Link
                  to="/register"
                  className={cn(
                    MONO,
                    CTA_INVERT,
                    // lime focus ring (from .focus-ring) on the void offset — an
                    // ink ring would be invisible on this dark panel.
                    'focus-ring inline-flex h-11 items-center rounded-btn bg-lime px-4 text-ink focus-visible:ring-offset-void group-focus-within/cta:bg-ink group-focus-within/cta:text-lime hover-hover:group-hover/cta:bg-ink hover-hover:group-hover/cta:text-lime',
                  )}
                >
                  Start applying
                </Link>
                <ArrowSquare size="lg" variant="inverted" decorative to="/register" aria-label="Start applying" />
              </div>
              <Link to="/login" className={cn(MONO, footLink, 'ml-2')}>
                Log in
              </Link>
            </div>
            <p className={cn(MONO, 'mt-8 text-text-2-dark')}>
              FREE WHILE IN BETA · GMAIL CONNECT TAKES TWO MINUTES.
            </p>
          </motion.div>

          {/* right: link columns + scroll-to-top */}
          <div className="flex flex-wrap items-start gap-10">
            <motion.nav {...item} aria-label="Footer navigate" className="border-l border-graphite pl-6">
              <span className={cn(MONO, 'text-text-2-dark')}>NAVIGATE</span>
              <ul className="mt-4 space-y-3">
                {NAV.map((l) => (
                  <li key={l.hash}>
                    <a href={l.hash} onClick={onNavClick(l.hash)} className={cn('font-sans text-body-lg', footLink)}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.nav>

            <motion.nav {...item} aria-label="Footer connect" className="border-l border-graphite pl-6">
              <span className={cn(MONO, 'text-text-2-dark')}>CONNECT</span>
              {/* TODO(social): wire real profiles when they exist */}
              <ul className="mt-4 space-y-3">
                <li>
                  <a href="#" className={cn('font-sans text-body-lg', footLink)}>
                    LinkedIn
                  </a>
                </li>
                <li>
                  <a href="#" className={cn('font-sans text-body-lg', footLink)}>
                    X
                  </a>
                </li>
              </ul>
            </motion.nav>

            <motion.div {...item}>
              <button
                type="button"
                onClick={onScrollTop}
                aria-label="Back to top"
                className="focus-ring flex size-14 items-center justify-center rounded-pill border border-graphite text-paper transition-colors hover:border-text-3-dark focus-visible:ring-offset-void"
              >
                <ArrowUp aria-hidden className="size-5" strokeWidth={1.5} />
              </button>
            </motion.div>
          </div>

          {/* baseline strip, above the giant wordmark */}
          <motion.div
            {...item}
            className="mt-6 flex w-full flex-wrap items-center justify-between gap-4"
          >
            <span className={cn(MONO, 'text-text-2-dark')}>© 2026 GETHIRED · ALL RIGHTS RESERVED.</span>
            <span className={cn(MONO, 'text-text-2-dark')}>BUILT QUIETLY</span>
          </motion.div>
        </div>

        {/* hero-scale wordmark, bleeding off the bottom edge */}
        <motion.div {...wordItem} className="mt-auto w-full px-6">
          <span className="block translate-y-[0.06em] whitespace-nowrap text-[clamp(84px,19vw,320px)] font-normal leading-[0.9] tracking-[-0.03em] text-paper">
            GetHired
          </span>
        </motion.div>
      </motion.div>
    </footer>
  );
}
