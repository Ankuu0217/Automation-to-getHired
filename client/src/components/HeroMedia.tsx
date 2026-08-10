import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Hero background media — a GPU-decoded looping <video> (webm/mp4 with a poster
 * for instant paint). Unlike a per-frame WASM canvas, video decode/compose runs
 * off the main thread and is composited like an image, so it costs ~0 scroll
 * frames — this is the change that fixes the hero scroll lag.
 *
 * The footage is blue; the brand is ink-green + lime, so a `.hero-video` filter
 * pulls it toward ink-green and the legibility stack (tint · scrims · vignette ·
 * grain) re-homes it in the palette while keeping the headline AA-legible.
 *
 * Battery/CPU hygiene (NOT for scroll — video decode does not cost scroll
 * frames): pause when the tab is hidden (visibilitychange) and when the hero is
 * fully off-screen (IntersectionObserver). Reduced motion renders the poster
 * as a plain <img> only — the video is never fetched. On load failure the media
 * is dropped and the .hero-mesh gradient beneath carries the hero. The whole
 * stack is decorative (aria-hidden).
 */

const POSTER = '/hero/underwater-poster.jpg';

interface HeroMediaProps {
  /** Prefers-reduced-motion — show the poster image only; never fetch the video. */
  reduce: boolean;
  /** Fires on load failure so a caller could react; the mesh already shows through. */
  onError?: () => void;
}

export function HeroMedia({ reduce, onError }: HeroMediaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visibleRef = useRef(true);
  const [failed, setFailed] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fail = useCallback(() => {
    setFailed(true);
    onErrorRef.current?.();
  }, []);

  /* Play only when on-screen AND tab-visible. Keeps playing during scroll on
     purpose — decode is off-thread. (No-op under reduce: no <video> is mounted.) */
  const sync = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!visibleRef.current || document.hidden) {
      v.pause();
      return;
    }
    const p = v.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }, []);

  useEffect(() => {
    // visibilitychange is attached unconditionally; only the IO is optional.
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | undefined;
    const el = wrapRef.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        ([entry]) => {
          visibleRef.current = entry.isIntersecting;
          sync();
        },
        { threshold: 0 },
      );
      io.observe(el);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, [sync]);

  return (
    <div ref={wrapRef} aria-hidden className="absolute inset-0 overflow-hidden">
      {!failed &&
        (reduce ? (
          <img
            src={POSTER}
            alt=""
            aria-hidden
            className="hero-video absolute inset-0 size-full object-cover"
            onError={fail}
          />
        ) : (
          <video
            ref={videoRef}
            className="hero-video absolute inset-0 size-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={POSTER}
            aria-hidden
            // A <video>'s own error event does NOT fire when its <source> children
            // fail; the error fires on the LAST source once all candidates are
            // exhausted. Handle failure there (plus video-level for a direct src).
            onError={fail}
          >
            <source src="/hero/underwater.webm" type="video/webm" />
            <source src="/hero/underwater.mp4" type="video/mp4" onError={fail} />
          </video>
        ))}
      {/* Legibility stack (paint bottom → top): tint · top-scrim · bottom-scrim ·
          vignette · grain. Tint only knocks the bright footage back to brand ink,
          so on failure it's dropped and the dark mesh stands unaided. */}
      {!failed && <div className="pointer-events-none absolute inset-0 bg-ink/[0.42]" />}
      <div className="hero-scrim-top pointer-events-none absolute inset-0" />
      <div className="hero-scrim pointer-events-none absolute inset-0" />
      <div className="hero-vignette pointer-events-none absolute inset-0" />
      <div className="hero-grain pointer-events-none absolute inset-0" />
    </div>
  );
}
