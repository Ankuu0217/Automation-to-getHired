import { useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';

/*
 * Boy Ball — a boy who sits on the "S" of the "Screenshots in…" heading and
 * lobs a ball up into the open space above the line, forever (2.08s SMIL loop).
 *
 * Anchoring: this renders INSIDE a position:relative <span> that wraps just the
 * leading "S", so `left: 50%` is the S's own centre — the boy stays seated on
 * the letter no matter how the right-aligned heading re-wraps. The seat contact
 * point sits at (SEAT_X, SEAT_Y) of the box; those fractions were measured on
 * the real glyph so the boy's butt rests on the S's top edge, centred.
 *
 * The art is inlined (dangerouslySetInnerHTML) so its SMIL runs — an <img>
 * renders it frozen. Reduced motion freezes it deliberately; off-screen the
 * SMIL is paused so its timelines don't burn the main thread unseen.
 */

// Fixed box (the heading it rides is a fixed 58px, so a fixed boy keeps a
// constant, balanced proportion to the "S"). Visible boy ≈ 0.39×box ≈ 138px,
// ~2.4× the cap — present but not overwhelming, and clear of the band above.
const BOX = 350; // px
const SEAT_X = 0.573; // butt-centre x / box  → centres the boy on the S (box-independent)
const SEAT_Y = 0.836; // butt-bottom y / box  → where his seat sits inside the box
// Aspekta seats its 58px caps ~23px below the inline-box top. This is a FIXED px
// metric, NOT a fraction of the box — so it must be added separately, otherwise
// the seat drifts off the letter whenever BOX changes. top = CAP_INSET − seatY·box
// places the butt on the S's VISIBLE cap-top at any box size.
const CAP_INSET = 23; // px

export function BoyBall({ boySvg }: { boySvg: string | null }) {
  const reduce = useReducedMotion();
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const svg = hostRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    if (reduce) {
      try {
        svg.setCurrentTime(0);
        svg.pauseAnimations();
      } catch {
        /* SMIL controls unsupported — harmless */
      }
      return;
    }
    // Pause the 2.08s loop while off-screen (perf); resume when it scrolls in.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          try {
            if (e.isIntersecting) svg.unpauseAnimations();
            else svg.pauseAnimations();
          } catch {
            /* ignore */
          }
        }
      },
      { rootMargin: '160px' },
    );
    io.observe(svg);
    return () => io.disconnect();
  }, [boySvg, reduce]);

  if (!boySvg) return null;

  return (
    <span
      aria-hidden
      ref={hostRef}
      className="pointer-events-none absolute z-[10] hidden md:block [&>svg]:block [&>svg]:size-full [&>svg]:overflow-visible"
      style={{
        width: BOX,
        height: BOX,
        left: `calc(50% - ${SEAT_X * BOX}px)`,
        top: `calc(${CAP_INSET}px - ${SEAT_Y * BOX}px)`,
      }}
      dangerouslySetInnerHTML={{ __html: boySvg }}
    />
  );
}
