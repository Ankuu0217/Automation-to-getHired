import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * App-wide motion system (the "dashboard transition" look): a persistent shell,
 * content that slides + fades in on every route change, page headings that
 * reveal word-by-word, cards/sections that stagger up, and KPI numbers that
 * count up. Everything degrades gracefully — the global
 * `<MotionConfig reducedMotion="user">` strips transforms for framer pieces, and
 * the custom hooks below check `useReducedMotion()` themselves and jump to the
 * final state.
 *
 * Reuses the landing motion vocabulary (same ease-out curve) so the whole
 * product feels like one hand made it.
 */

/** Premium ease-out — the landing pages already use this curve. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/* ── Route-enter: the content area slides in from the right + fades ─────── */
export const pageEnter: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.42, ease: EASE_OUT } },
};

/* ── Stagger: sections/cards rise + fade in sequence ────────────────────── */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

/**
 * Staggered container. Wrap a page's top-level vertical stack (or a card grid)
 * in this and make each direct child a {@link StaggerItem}. Animates on mount by
 * default (replays on every route change because the shell remounts the page);
 * pass `inView` to defer until scrolled into view for long, below-the-fold
 * sections.
 */
export function Stagger({
  children,
  className,
  inView = false,
  ...rest
}: HTMLMotionProps<'div'> & { children: ReactNode; inView?: boolean }) {
  const activate = inView
    ? { whileInView: 'show' as const, viewport: { once: true, margin: '-10%' } }
    : { animate: 'show' as const };
  return (
    <motion.div className={className} variants={staggerParent} initial="hidden" {...activate} {...rest}>
      {children}
    </motion.div>
  );
}

const STAGGER_TAGS = {
  div: motion.div,
  section: motion.section,
  article: motion.article,
  ul: motion.ul,
  li: motion.li,
} as const;

/**
 * A staggered child. Prefer REPLACING an existing wrapper element with this and
 * carrying its `className` over, rather than adding a new nesting level, so grid
 * / flex layouts are preserved. Pass `as` to keep semantic tags (`section`,
 * `li`, …) instead of the default `div`.
 */
export function StaggerItem({
  children,
  className,
  as = 'div',
  ...rest
}: HTMLMotionProps<'div'> & { children: ReactNode; as?: keyof typeof STAGGER_TAGS }) {
  const Comp = (STAGGER_TAGS[as] ?? motion.div) as typeof motion.div;
  return (
    <Comp className={className} variants={staggerChild} {...rest}>
      {children}
    </Comp>
  );
}

/* ── Heading: reveal word-by-word (blur + rise) ─────────────────────────── */

const headingWordVariants: Variants = {
  hidden: { opacity: 0, y: 10, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: EASE_OUT } },
};

type HeadingTag = 'h1' | 'h2' | 'h3';

/**
 * A page/section title that reveals one word at a time. Falls back to plain,
 * fully-visible text under reduced motion (and keeps an accessible label so
 * screen readers always read the whole title at once).
 */
export function RevealHeading({
  text,
  className,
  as = 'h1',
  delay = 0,
}: {
  text: string;
  className?: string;
  as?: HeadingTag;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    const Plain = as;
    return <Plain className={className}>{text}</Plain>;
  }
  const Comp = as === 'h2' ? motion.h2 : as === 'h3' ? motion.h3 : motion.h1;
  const words = text.split(' ');
  return (
    <Comp
      className={className}
      aria-label={text}
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.05, delayChildren: delay } } }}
    >
      {words.map((word, i) => (
        <motion.span key={`${word}-${i}`} aria-hidden className="inline-block" variants={headingWordVariants}>
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </Comp>
  );
}

/* ── CountUp: KPI numbers tick from 0 to their value ────────────────────── */

/**
 * Animates a number from 0 up to `value` when it scrolls into view (once).
 * `format` turns the raw number into the display string (commas, currency, %,
 * units). Jumps straight to the final value under reduced motion.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10%' });
  const formatRef = useRef(format);
  formatRef.current = format;
  const [display, setDisplay] = useState(() => format(reduce ? value : 0));

  useEffect(() => {
    if (reduce) {
      setDisplay(formatRef.current(value));
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(formatRef.current(v)),
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {display}
    </span>
  );
}

/* ── ProgressFill: a bar that grows from 0 to its target on mount ───────── */

/**
 * A horizontal fill that draws from 0 → `pct`% when it mounts. Use for goal /
 * funnel / progress bars so they "draw in" on every route entry. Jumps straight
 * to the final width under reduced motion (width isn't a transform, so the
 * global MotionConfig won't strip it — we gate it here).
 */
export function ProgressFill({
  pct,
  className,
  duration = 0.8,
  delay = 0.1,
}: {
  pct: number;
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const target = `${Math.max(0, Math.min(100, pct))}%`;
  return (
    <motion.div
      className={cn('h-full rounded-pill bg-lime', className)}
      initial={{ width: reduce ? target : '0%' }}
      animate={{ width: target }}
      transition={reduce ? { duration: 0 } : { duration, ease: EASE_OUT, delay }}
    />
  );
}

/* ── Formatting helpers for CountUp ─────────────────────────────────────── */
export const fmtInt = (n: number) => Math.round(n).toLocaleString();
export const fmtUSD = (n: number) => `$${Math.round(n).toLocaleString()}`;
export const fmtPct = (digits = 0) => (n: number) => `${n.toFixed(digits)}%`;
export const fmtMs = (n: number) => `${Math.round(n)} ms`;
