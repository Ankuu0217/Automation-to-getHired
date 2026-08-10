import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

/*
 * Reading Bird — "Curious Peek" (design-panel winner).
 *
 * On a desktop hover the bird notices you: it peeks up off its book with a
 * springy pop, translates + tilts in 3D toward the cursor (the face lags the
 * torso on a softer spring — real parallax), cocks its head a few degrees, then
 * eases home when you leave. Transform/opacity only, spring-smoothed, 60fps.
 *
 * Only the pointer-follow is desktop-only; the SVG's own SMIL loop plays
 * everywhere. Reduced motion is handled by the caller (renders a still <img>),
 * so this component is only mounted when motion is allowed. The 3D tilt uses the
 * `perspective` the caller sets on the entrance wrapper.
 */

const TX = 16; // px translate toward the cursor (horizontal lean)
const TY = 13; // px translate toward the cursor (vertical lean)
const ROT_Y = 11; // deg 3D turn-to-face
const ROT_X = 8; // deg 3D pitch — peek up / dip toward you
const ROT_Z = 3; // deg in-plane head-cock
const LIFT = 7; // px extra upward "peek off the book" on notice
const POP = 1.05; // scale on notice — a breath, not a bounce-house

const BODY = { stiffness: 190, damping: 19, mass: 0.6 } as const; // composed follow
const TILT = { stiffness: 130, damping: 15, mass: 0.8 } as const; // softer → face trails torso
const NOTICE = { stiffness: 300, damping: 15, mass: 0.8 } as const; // one bouncy overshoot

const SIZE = 'size-[clamp(300px,34vw,460px)]';
const clamp1 = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** True hover + fine pointer — gates the pointer-follow (touch/coarse gets none). */
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

export function ReadingBird({ birdSvg }: { birdSvg: string | null }) {
  const fine = useFinePointer();

  // normalized pointer offset from the box centre, -1..1, and the notice beat
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const notice = useMotionValue(0);

  // body + tilt share px/py but ride different springs → parallax lag
  const bodyX = useSpring(px, BODY);
  const bodyY = useSpring(py, BODY);
  const tiltX = useSpring(px, TILT);
  const tiltY = useSpring(py, TILT);
  const pop = useSpring(notice, NOTICE);

  const x = useTransform(bodyX, (v) => v * TX);
  const y = useTransform([bodyY, pop], (l) => (l as number[])[0] * TY - (l as number[])[1] * LIFT);
  const rotateY = useTransform(tiltX, (v) => v * ROT_Y);
  const rotateX = useTransform(tiltY, (v) => -v * ROT_X);
  const rotateZ = useTransform(tiltX, (v) => v * ROT_Z);
  const scale = useTransform(pop, [0, 1], [1, POP], { clamp: false });

  // rect cached on enter → pointermove is pure math, zero layout reads
  const rectRef = useRef<DOMRect | null>(null);
  const onEnter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    rectRef.current = e.currentTarget.getBoundingClientRect();
    notice.set(1);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const r = rectRef.current ?? e.currentTarget.getBoundingClientRect();
    px.set(clamp1(((e.clientX - r.left) / r.width) * 2 - 1));
    py.set(clamp1(((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const onLeave = () => {
    rectRef.current = null;
    px.set(0);
    py.set(0);
    notice.set(0);
  };

  // the bird — animated inline SVG (SMIL runs) once fetched, else a still <img>
  const bird = birdSvg ? (
    <div
      aria-hidden
      className="pointer-events-none block size-full [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: birdSvg }}
    />
  ) : (
    <img src="/media/reading-book.svg" alt="" aria-hidden className={`pointer-events-none block ${SIZE}`} />
  );

  // touch/coarse pointer, or not yet fetched: animated bird, no pointer-follow
  if (!fine || !birdSvg) return <div className={`block ${SIZE}`}>{bird}</div>;

  return (
    // fixed, never-transformed listener box → stable hit zone; preserve-3d
    // carries the parent's perspective onto the tilted child.
    <div
      onPointerEnter={onEnter}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`pointer-events-auto block ${SIZE} [transform-style:preserve-3d]`}
    >
      <motion.div
        // pivot near the feet → the bird stands up and leans from a planted base
        style={{ x, y, rotateX, rotateY, rotateZ, scale, transformOrigin: '50% 80%' }}
        className="block size-full will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d]"
      >
        {bird}
      </motion.div>
    </div>
  );
}
