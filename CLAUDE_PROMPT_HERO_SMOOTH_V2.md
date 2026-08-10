# Claude Code Prompt — Fix hero scroll-lag + integratedbio.com-grade motion (v2)

> Paste everything below the line into Claude Code, run from the repo root
> `/Users/ankitsingh/Automations for getHired`. This SUPERSEDES the earlier
> Lottie prompt. Written against the real code: React 18 + Vite + TS +
> Tailwind 3 + framer-motion 12 + Lenis. Tokens in `client/src/index.css`,
> hero in `client/src/pages/Landing.tsx`, signature square in
> `client/src/components/ui/arrow-square.tsx`.

---

## READ THIS FIRST — the diagnosis (do not skip, it dictates every decision)

The current hero **lags on scroll** because it paints a **full-viewport
`dotLottie` (ThorVG) vector canvas every single frame on the main thread /
WASM**. On a 1440p display that's ~5M+ pixels software-rasterized 30–60×/sec,
*while* Lenis is transform-scrolling and framer-motion is running its own
scroll/inView work on the same thread. Three heavy things fight for one thread
→ dropped frames → the "lag" you feel. Two more amplifiers:
`.hero-mesh::before` runs a 24s infinite gradient animation (another full-bleed
painting layer), and the nav's `backdrop-blur-[12px]` re-samples the *moving*
hero behind it every frame.

**Why integratedbio.com is buttery** (I verified it — Awwwards SOTD by
Accomplice LLC, built with **GSAP + Vite + Lenis**, tags: *Parallax,
Microinteractions*): their hero is a **static image** that is only ever
**GPU-composited** (transform/opacity parallax). Nothing repaints the viewport
per frame. Smoothness = *never software-painting a full-bleed surface during
scroll.*

**So the fix is not "tune the Lottie" — it's remove the per-frame repaint.**
I already pre-rendered your `.lottie` to a **GPU-decoded video**, which keeps
the underwater motion but costs ~0 main-thread time (video decode is
off-thread and composited like an image). This is the single change that fixes
scroll.

## ASSETS — already committed to the repo, just use them

- `client/public/hero/underwater.mp4` (H.264, 8s seamless loop, ~780KB)
- `client/public/hero/underwater.webm` (VP9, ~450KB)
- `client/public/hero/underwater-poster.jpg` (first frame, for instant paint)

---

## TASK 0 — Replace the hero Lottie with a `<video>` (this fixes the lag)

1. **Remove** `@lottiefiles/dotlottie-react` from the hero entirely and
   uninstall it (`pnpm --filter @jobmail/client remove @lottiefiles/dotlottie-react`)
   — no WASM, no per-frame canvas. Delete `HeroLottie.tsx` if it exists.
2. New `client/src/components/HeroMedia.tsx` rendering:

```tsx
<video
  className="absolute inset-0 size-full object-cover"
  autoPlay muted loop playsInline
  poster="/hero/underwater-poster.jpg"
  aria-hidden
  // decode/compose off the main thread; keep it on its own GPU layer
  style={{ transform: 'translateZ(0)', contain: 'paint' }}
>
  <source src="/hero/underwater.webm" type="video/webm" />
  <source src="/hero/underwater.mp4" type="video/mp4" />
</video>
```

3. **Battery/CPU hygiene (not for scroll — for idle cost):** pause the video
   when the tab is hidden (`visibilitychange`) and when the hero is fully
   scrolled off (`IntersectionObserver`, threshold 0). **Keep it playing during
   scroll** — that's the whole point; video decode does not cost scroll frames.
4. Keep `.hero-mesh` as the layer *under* the video so there's never a flash
   before the poster paints, and `onError` → hide video, keep mesh.
5. `prefers-reduced-motion: reduce` → don't autoplay; show the poster only.

### Brand the footage (it's blue; brand is ink-green + lime)

Stack these over the video, all `pointer-events-none`, in this z-order:

- video
- **tint**: `background: rgb(34 47 48 / .42)` (`--ink` @ 42%) + on the video
  itself `filter: saturate(.9) hue-rotate(-12deg)` to pull blue → ink-green.
- **two-stop bottom scrim**: `linear-gradient(to top, rgba(13,26,23,.88) 0%,
  rgba(13,26,23,.45) 32%, transparent 60%)` (replaces the current single-stop).
- **vignette**: `radial-gradient(120% 90% at 50% 38%, transparent 46%,
  rgba(0,0,0,.36) 100%)`.
- **film grain**: inline SVG `feTurbulence` data-URI, `opacity:.05`,
  `mix-blend-mode:overlay`, tiled 180px. Kills banding, reads as film.

Verify headline + subtext clear **WCAG AA 4.5:1** against the *brightest*
frame (top-center of the loop is lightest). Screenshot 3 frames and check.

---

## TASK 1 — Kill the remaining scroll-jank sources (the #1 priority)

Do every one of these and measure before/after:

1. **Delete the `.hero-mesh::before` 24s infinite gradient animation.** With
   the video in place it's invisible anyway and it's a full-bleed animating
   paint layer. Keep the static `.hero-mesh` gradient as the pre-poster base.
2. **One rAF only.** Lenis owns the scroll loop (`new Lenis({ autoRaf: true })`
   is already there — keep exactly one Lenis instance, it's fine). Do **not**
   add a second `requestAnimationFrame` scroll loop.
3. **Don't let framer-motion poll scroll independently while Lenis transforms.**
   For any scroll-linked value, read it from Lenis and push into a
   `useMotionValue` inside Lenis's own callback:
   ```ts
   const y = useMotionValue(0);
   useEffect(() => {
     const l = lenisRef.current; if (!l) return;
     const cb = ({ scroll }) => y.set(scroll);
     l.on('scroll', cb); return () => l.off('scroll', cb);
   }, []);
   ```
   Derive parallax with `useTransform` off that MV. No component should call
   `useScroll()` with its own listener on top of Lenis.
4. **Nav backdrop-blur over moving video is expensive.** Fix one of two ways:
   (a) drop blur to `backdrop-blur-[6px]` **and** add `isolation:isolate` +
   `will-change:auto` on the nav, or (b) keep it crisp: make the nav
   background opaque `bg-bone` after 48px of scroll and blur only in the top
   ~48px where the video is calm. Prefer (b) — it's what premium sites do.
5. **`content-visibility:auto` + `contain-intrinsic-size: <approx px>`** on
   every `<section>` below the hero. This stops off-screen sections from
   painting/laying-out during scroll — big win.
6. **Animate only compositor properties** anywhere on this page: `transform`,
   `opacity`, `clip-path`, `filter`, `background-color`, `color`. Never
   `width/height/top/left/margin`. Grep the file and fix any offenders.
7. **`will-change` discipline:** add on animation start, **remove on
   completion** (framer's `onAnimationComplete`). Never leave it set — it's a
   memory cost, worst on mobile Safari.
8. **Hero parallax** (subtle, integratedbio-style), all clamped and spring-
   smoothed so a trackpad flick never snaps:
   - video: `y: 0 → -6%`, `scale: 1 → 1.06` across `[0, 0.6]` of hero scroll
   - headline: `y: 0 → -32px`, `opacity: 1 → 0` across `[0, 0.5]`
   Wrap each in `useSpring(mv, { stiffness: 120, damping: 26, mass: 0.4 })`.

**Acceptance:** on Chrome **4× CPU throttle**, record a Performance trace while
scrolling the hero → below-fold → back. Report the FPS. Target **58fps+**. If
any long task > 50ms shows up, name it and remove it.

---

## TASK 2 — Load choreography (this exact order — it's what I asked for)

After first paint the elements enter in this sequence. The **headline leads**,
the media reveals **last**.

| Order | Element | Enter | Start (s) | Dur |
|---|---|---|---|---|
| 1 | `<h1>` "From screenshot / to sent." | fade-rise `y 28→0`, per-line stagger 90ms | 0.15 | 0.7 |
| 2 | Eyebrow (lime dot + `COLD OUTREACH…`) | fade-rise `y 20→0` | 0.55 | 0.6 |
| 3 | Nav pill (whole `<header>`) | fade `opacity 0→1`, `y 8→0` | 0.85 | 0.5 |
| 4 | Subparagraph + CTA cluster | fade-rise, stagger 90ms | 1.10 | 0.6 |
| 5 | **Hero media (video stack)** | reveal LAST — `clip-path: inset(0 0 100% 0 round 0)` → `inset(0 0 0% 0)` **+** `scale 1.08→1`, `opacity 0→1` | 1.35 | 0.9 |

- Easing everywhere: the file's `EASE = [0.16,1,0.3,1]` (expo-out).
- Drive it with **one** framer orchestration: a parent with
  `variants` + `staggerChildren`/`delayChildren`, or explicit `delay`s. Don't
  scatter `whileInView` on the hero — the hero animates on **mount**, once.
- The video **element mounts and starts playing immediately** (behind its
  clip mask) so there's no play-pop when it reveals. It's already looping under
  the mask; you're only revealing the container.
- Lock `document.body.style.overflow='hidden'` until step 5 completes, then
  release, so nobody scrolls mid-intro.
- **Play once per session:** `sessionStorage['gh:hero-intro']`. Client-side
  route changes back to `/` must not replay it.
- `prefers-reduced-motion` → render all final states, single 200ms opacity
  fade, no clip/scale, no scroll lock.

---

## TASK 3 — integratedbio-grade polish (restraint + precision, not more effects)

**Scroll reveals (below the fold) — reuse ONE motion vocabulary.** Replace
scattered `opacity+y` reveals with the same mask language as the hero media:
`clip-path: inset(0 0 100% 0)` → `inset(0 0 0% 0)` + `y:16→0`, 700ms, `EASE`,
`viewport={{ once:true, margin:'-12%' }}`. The page then reads as one system.
This is literally integratedbio's "image reveal on scroll."

**Typography**
- `text-wrap: balance` on every `<h1>/<h2>`; `text-wrap: pretty` on body.
- Optical tracking ramp (encode as Tailwind `letterSpacing` tokens, no
  scattered arbitrary values): `128px → -0.03em`, `72px → -0.025em`,
  `40px → -0.02em`, `body → -0.005em`.
- `font-variant-numeric: tabular-nums` on every number / mono label.
- Body measure capped at `68ch`.

**Microinteractions (integratedbio tag: "Microinteractions")**
- Nav scrolled state: `py 12→8`, background `bone/70 → bone/92`, add a 1px
  `--lichen` hairline, 250ms. (Also satisfies Task 1.4.)
- Optional hero cursor-light (desktop + `hover:hover` only): a 520px radial
  `--lime` at `opacity .06`, position lerped `0.08` toward pointer in the
  Lenis rAF, `mix-blend-mode: soft-light`. If it costs >1ms/frame, delete it.

**Surface & accent discipline (already in the token doc — enforce it)**
- Zero `box-shadow`. Depth = surface steps `--ink → --ink-2 → --ink-3` + 1px
  hairlines only.
- Lime only at micro-scale (dots, arrow square, active pill, focus ring,
  hover invert). If lime is >~2% of any viewport, it's wrong.

---

## TASK 4 — One hover grammar (copy integratedbio's CTA invert)

The hero CTA + its arrow square **invert as one unit** on hover:

| | Rest | Hover |
|---|---|---|
| Pill bg / label | `--lime` / `--ink` | `--ink` / `--lime` |
| Square bg / arrow | `--ink` / `--lime` | `--lime` / `--ink` |

- 320ms, `cubic-bezier(.16,1,.3,1)`, on `background-color`+`color` only (never
  `transition:all`). Arrow also `translate-x-[2px]`.
- Wrap pill + square in one `<div className="group/cta">`; drive both with
  `group-hover/cta:` so they flip on the **same frame**, even when the cursor is
  in the gap between them. Whole cluster `translateY(-1px)` on hover, `0` on
  `:active`.
- `:focus-visible` = identical inverted state + existing `.focus-ring`.
- Wrap in `@media (hover:hover)` so it doesn't stick after a tap.
- Add a `variant="inverted"` prop to `ArrowSquare` (default `'lime'`) so app-
  scale usages elsewhere are untouched; update its doc comment.
- Apply the same invert to the nav's `Start applying` button — one grammar.

---

## DELIVERABLES

1. Green `pnpm --filter @jobmail/client lint` and `test`.
2. New: `HeroMedia.tsx`, hero intro orchestration, `arrow-square.tsx` inverted
   variant. Removed: dotLottie dep + `HeroLottie.tsx`.
3. New tokens in **both** `index.css` and `tailwind.config.ts` (letterSpacing,
   any nav-scroll values). Keep the two files in sync.
4. `docs/HERO_MOTION.md`: the two tables above as implemented, easing curves,
   how to disable the intro (clear the sessionStorage key).
5. **Report back the numbers:** FPS on 4× throttle during hero scroll (before
   vs after), LCP, CLS, and the 3 contrast ratios you measured for the headline
   over the loop.

## RULES

- No new animation library. framer-motion + CSS + the existing Lenis is enough.
- Do **not** change copy, routes, or section order.
- No `transition: all`, no `!important`, no inline `style` for anything
  animatable (the `translateZ`/`contain` on the video is fine — it's static).
- Never hardcode a hex; use the CSS tokens.
- Show me a per-file diff summary before you start editing.
- If any spec conflicts with the token system, follow the tokens and tell me
  which line you overrode and why.
