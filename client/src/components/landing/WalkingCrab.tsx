import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

/*
 * Walking Crab — a decorative crab that patrols the dark→light seam between the
 * "Built for the search" band (#company) and "HOW IT WORKS" (#how).
 *
 * It scuttles the RIGHT HALF of the seam — visual centre parked on the 50% mark,
 * travelling until its widest point is one gap shy of the viewport edge, then
 * back, forever. The art is front-facing and ~symmetric, so — like a real crab
 * moving sideways — it never turns to face its direction; a ±1.25° lean sells
 * the intent instead. Its legs come from the SVG's own SMIL walk cycle (which
 * only runs when the SVG is INLINED, never in an <img>).
 *
 * Motion tech (design-panel winner): the patrol + lean is a pure CSS @keyframes
 * animation whose bounds are `calc(vw…)` custom properties — so it is
 * compositor-only, needs ZERO JS, and re-resolves on resize with no listeners.
 * The only JS motion is the desktop "flee": the crab darts away from a nearby
 * cursor (framer spring), viewport-clamped so it can never shear off the edge.
 * Reduced motion parks the patrol (global CSS rule) and freezes the SMIL.
 */

// Geometry knobs, all set on the rail so they inherit into the keyframes.
//  --s     the crab box; the visible art is a fraction of it (transparent padding)
//  c=0.51  visual centre as a fraction of the box  → parks the centre on 50%
//  r=0.93  rightmost visible pixel as a fraction of the box → clip-proof right end
const RAIL_VARS = {
  '--s': 'clamp(144px, 13vw, 212px)',
  '--x-left': 'calc(50vw - 0.51 * var(--s))',
  '--x-right': 'calc(100vw - 18px - 0.93 * var(--s))',
} as CSSProperties;

// Box centred on the seam: feet rest on the bone floor, body rises into the dark.
const SEAT_TOP = 'calc(-0.5 * var(--s))';

const FLEE_RADIUS = 140; // px cursor proximity that triggers the dodge
const FLEE_PUSH = 22; // px max sideways dart away from the cursor
const FLEE_DUCK = 4; // px it ducks as it flinches
const SPRING = { stiffness: 380, damping: 26, mass: 0.7 } as const;

/** True hover + fine pointer — gates the flee (touch/coarse gets none). */
function useFinePointer(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setOk(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return ok;
}

export function WalkingCrab({ crabSvg }: { crabSvg: string | null }) {
  const reduce = useReducedMotion();
  const fine = useFinePointer();
  const hostRef = useRef<HTMLDivElement>(null); // wraps the inline <svg>
  const fleeRef = useRef<HTMLDivElement>(null);

  // Flee offsets (identity at rest). Springs settle and stop → no idle rAF.
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const ts = useMotionValue(1);
  const fx = useSpring(tx, SPRING);
  const fy = useSpring(ty, SPRING);
  const fs = useSpring(ts, { stiffness: 300, damping: 22 });

  // SMIL control: freeze under reduced motion; pause off-screen otherwise so the
  // 134-timeline walk cycle isn't burning the main thread when unseen.
  useEffect(() => {
    const host = hostRef.current;
    const svg = host?.querySelector('svg') as SVGSVGElement | null;
    if (!host || !svg) return;
    if (reduce) {
      try {
        svg.setCurrentTime(0);
        svg.pauseAnimations();
      } catch {
        /* SMIL controls unsupported — harmless */
      }
      return;
    }
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
      { rootMargin: '120px' },
    );
    io.observe(host);
    return () => io.disconnect();
  }, [crabSvg, reduce]);

  // Desktop flee: dart away from a nearby cursor, clamped inside the viewport.
  useEffect(() => {
    if (reduce || !fine) return;
    let raf = 0;
    let ev: PointerEvent | null = null;
    const apply = () => {
      raf = 0;
      const e = ev;
      const el = fleeRef.current;
      if (!e || !el) return;
      const r = el.getBoundingClientRect(); // live: the crab is always moving
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = cx - e.clientX;
      const dy = cy - e.clientY;
      const dist = Math.hypot(dx, dy);
      if (dist > FLEE_RADIUS) {
        tx.set(0);
        ty.set(0);
        ts.set(1);
        return;
      }
      const k = 1 - dist / FLEE_RADIUS; // 0 at the edge of the band, 1 at contact
      let push = Math.sign(dx || 1) * FLEE_PUSH * k; // away from the cursor
      // Clamp so the dart can never cross the viewport edges (the flaw every
      // interactive design shipped): keep an 8px margin on both sides.
      const min = 8 - r.left;
      const max = window.innerWidth - 8 - r.right;
      push = Math.max(min, Math.min(max, push));
      tx.set(push);
      ty.set(FLEE_DUCK * k);
      ts.set(0.96);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      ev = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduce, fine, tx, ty, ts]);

  if (!crabSvg) return null;

  // The inline animated crab (SMIL runs; transparent over the seam).
  const crab = (
    <div
      ref={hostRef}
      className="block size-full [&>svg]:block [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: crabSvg }}
    />
  );

  return (
    // Rail: full-width, zero-height layer pinned to the seam (top of #how).
    <div
      aria-hidden
      style={RAIL_VARS}
      className="pointer-events-none absolute inset-x-0 top-0 z-[10] hidden h-0 md:block"
    >
      {/* Placement: static Y (a top, not a transform) so patrol translateX never
          fights it — and the crab lands correctly even if no script runs. */}
      <div
        className="absolute left-0"
        style={{ width: 'var(--s)', height: 'var(--s)', top: SEAT_TOP }}
      >
        {/* Patrol + lean (CSS; reduced motion parks it at the 50% mark). */}
        <div
          className="size-full will-change-transform"
          style={
            reduce
              ? { transform: 'translateX(var(--x-left))' }
              : { animation: 'crab-patrol 24.02s linear infinite' }
          }
        >
          {/* Bob: a 2px breathing lift, half the walk-cycle period. */}
          <div
            className="size-full will-change-transform"
            style={reduce ? undefined : { animation: 'crab-bob 1.201s ease-in-out infinite' }}
          >
            {/* Flee: desktop cursor dodge. Plain (identity) when idle/coarse/reduced. */}
            {reduce || !fine ? (
              <div className="size-full">{crab}</div>
            ) : (
              <motion.div
                ref={fleeRef}
                className="size-full will-change-transform"
                style={{ x: fx, y: fy, scale: fs }}
              >
                {crab}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
