# Claude Code Prompt — Hero: Lottie media + integratedbio.com-grade reveal + premium pass

> Paste everything below the line into Claude Code from the repo root
> (`/Users/ankitsingh/Automations for getHired`). It is written against the
> real codebase: React 18 + Vite + TS + Tailwind 3 + framer-motion 12 + Lenis,
> tokens in `client/src/index.css`, hero in `client/src/pages/Landing.tsx`.

---

## ROLE

You are a principal frontend engineer + motion designer. Your bar is
Awwwards Site of the Day, not "it works". Every number below is a spec, not a
suggestion. If you can't hit 60fps, change the technique — never the spec.

## CONTEXT — read these first, do not guess

- `client/src/pages/Landing.tsx` — the page you are changing. Hero is the
  `<section className="hero-mesh ...">` block.
- `client/src/index.css` — the token set. **Never** hardcode a hex. Use
  `--ink #222f30`, `--lime #cef79e`, `--bone #f7f7f5`, `--paper #fff`,
  `--graphite #4d5757`, `--lichen #c9cbbe`, radii `--r-btn 10px`,
  `--r-arrow 14px`, `--r-pill 9999px`.
- `client/src/components/ui/arrow-square.tsx` — the signature lime square.
- `client/tailwind.config.ts` — mirrors the tokens. Keep both in sync.
- Motion easing already used in the file: `EASE = [0.16, 1, 0.3, 1]`
  (expo-out). Everything below uses it unless stated.

**Hard constraint: all existing hero copy, nav links, CTAs, section order and
routing stay byte-identical.** You are changing the hero's *background media*
and the *motion/interaction layer* only, then doing a polish pass. Do not
rewrite copy. Do not remove sections.

---

## TASK 1 — Replace the hero background render with the Lottie

**Asset:** `Underwater Ocean Fish and Turtle.lottie` → commit it to
`client/public/hero/underwater.lottie`.

**Player:** install `@lottiefiles/dotlottie-react` (it plays `.lottie`
natively via the ThorVG WASM renderer — do **not** unzip it and use
`lottie-web`, and do **not** add `lottie-react`).

```bash
pnpm --filter @jobmail/client add @lottiefiles/dotlottie-react
```

Build `client/src/components/HeroLottie.tsx`:

```tsx
<DotLottieReact
  src="/hero/underwater.lottie"
  autoplay
  loop
  useFrameInterpolation          // REQUIRED — this is the "smooth" the brief asks for
  renderConfig={{ autoResize: true, devicePixelRatio: Math.min(window.devicePixelRatio, 2) }}
  className="absolute inset-0 size-full"
/>
```

Smoothness requirements — all of them:

1. `useFrameInterpolation` on. The source comp is 30fps / 240 frames; without
   interpolation it visibly stutters on a 120Hz display. With it on, playback
   is resampled to the display refresh rate.
2. Wrap the canvas so it behaves like `object-fit: cover` at every viewport:
   absolutely positioned, `min-w-full min-h-full`, `left-1/2 top-1/2
   -translate-x-1/2 -translate-y-1/2`, aspect locked to 1242/720. Never let it
   letterbox and never let it distort.
3. `dpr` capped at 2. Uncapped DPR on a 4K/Retina full-bleed canvas is the
   #1 cause of dropped frames here.
4. Pause when off-screen and when the tab is hidden:
   `IntersectionObserver` (threshold 0) → `dotLottie.pause()/play()`, plus a
   `visibilitychange` listener. Never burn CPU behind a scrolled-past hero.
5. `prefers-reduced-motion: reduce` → render frame 0 as a still, no loop.
6. Keep the existing `.hero-mesh` CSS gradient as the layer *underneath* the
   canvas so there is never a flash of empty background while the WASM
   renderer boots, and so a load failure degrades to today's look. Add
   `onError` → hide the canvas, keep the mesh.
7. `aria-hidden` on the whole media stack. It is decoration.

**Legibility layer (this is what makes it look art-directed rather than
"a video behind text"), in this z-order, all `pointer-events-none`:**

- the `.hero-mesh` gradient (existing)
- the Lottie canvas
- a **tint**: `bg-ink/45` — the source art is bright cyan/blue and the brand
  is near-black ink-green. Without this the hero stops belonging to the site.
- a **two-stop bottom scrim**: `linear-gradient(to top, rgba(13,26,23,.86) 0%,
  rgba(13,26,23,.42) 34%, transparent 62%)` (replaces the current single-stop)
- a **vignette**: `radial-gradient(120% 90% at 50% 40%, transparent 45%,
  rgba(0,0,0,.34) 100%)`
- a **grain** layer at `opacity: .05`, `mix-blend-mode: overlay`, generated as
  an inline SVG `feTurbulence` data-URI, tiled at 180px, `will-change: auto`.
  This is the single highest-ROI premium trick: it kills gradient banding and
  reads as film rather than CSS.

Verify contrast after tinting: headline and subtext must clear **WCAG AA
(4.5:1)** against the *brightest* frame of the loop, not the average one.
Screenshot at least 3 frames across the 8s loop and check.

---

## TASK 2 — The page-load reveal (copy integratedbio.com exactly)

The reference is integratedbio.com's first paint. I frame-stepped it; here is
the exact choreography. Reproduce this beat for beat.

| t (s) | What happens |
|---|---|
| 0.00 | Viewport is flat `--bone` (`#f7f7f5`). Nothing else painted. Nav hidden. |
| 0.18 | A tiny **pill** appears dead-centre: ~44×26px, `border-radius: 9999px`, opacity 0→1 over 120ms. It is a *window* onto the hero, not a shape. |
| 0.18 → 1.28 | The pill **opens** to full-bleed. Width/height → 100vw/100vh, radius 9999px → 0. Easing `cubic-bezier(.16,1,.3,1)`. |
| 0.18 → 1.28 | Inside the window the media **counter-scales** `1.12 → 1.00` on the same curve. This is what sells it — the media looks stationary while the window opens over it. Without the counter-scale it reads as a cheap zoom. |
| 0.95 | Nav pill fades in (`opacity 0→1`, `y 8→0`, 500ms). |
| 1.02 | Eyebrow (`COLD OUTREACH, INSTRUMENTED` + lime dot) fade-rise `y 24→0`, 600ms. |
| 1.10 | `<h1>` fade-rise, 700ms. Two lines, stagger 80ms per line. |
| 1.22 | Subparagraph + CTA cluster fade-rise, stagger 80ms. |
| ~1.9 | Settled. Lottie has been looping under the mask the entire time. |

**Implementation — non-negotiable technique:**

- Animate **`clip-path: inset()`**, not width/height/scale of the container.
  Start:
  `inset(calc(50% - 13px) calc(50% - 22px) calc(50% - 13px) calc(50% - 22px) round 9999px)`
  End: `inset(0% 0% 0% 0% round 0px)`.
  `clip-path` is GPU-composited; animating box size is not and will jank.
- The masked layer is `position: fixed; inset: 0` **during** the reveal, then
  swaps to the normal in-flow hero at completion (`onAnimationComplete`) so
  scrolling behaves normally. Lock `document.body.style.overflow = 'hidden'`
  for the 1.3s and release on completion.
- The Lottie mounts **before** the reveal starts and is already playing —
  do not mount it on reveal-complete, that produces a visible pop.
- Gate on the WASM renderer being ready OR a 600ms timeout, whichever fires
  first. Never let a slow asset hold the white screen past 600ms.
- **Play once per browser session**: `sessionStorage.getItem('gh:hero-reveal')`.
  Client-side route changes back to `/` must not replay it.
- `prefers-reduced-motion: reduce` → skip the mask entirely, render the final
  state, keep only a 200ms opacity fade.
- Add `will-change: clip-path` on mount and **remove it** on completion.
  Leaving `will-change` on permanently is a memory leak on mobile Safari.

---

## TASK 3 — The CTA hover (copy integratedbio.com exactly)

The reference's `DISCOVER OUR COMPANY` cluster is a two-part unit that
**colour-inverts as one** on hover. Frame-stepped values:

| | Rest | Hover |
|---|---|---|
| Pill background | `--lime` `#cef79e` | `--ink` `#222f30` |
| Pill label | `--ink` | `--lime` |
| Square background | `--ink` | `--lime` |
| Square arrow | `--lime` | `--ink` |

- Duration **320ms**, easing `cubic-bezier(.16,1,.3,1)`, on
  `background-color` and `color` only. No `transition: all`.
- The pill and the square are separate elements but share **one** hover
  scope: wrap them in `<div className="group/cta">` and drive both with
  `group-hover/cta:`. They must invert on the same frame — if the user's
  cursor is over the gap between them, both still invert.
- Arrow also `translate-x-[2px]`, 320ms, same curve.
- Whole cluster lifts `translateY(-1px)` on hover, returns to `0` on
  `:active` with a 120ms curve.
- `:focus-visible` produces the identical inverted state plus the existing
  `.focus-ring` — keyboard users get the same affordance as mouse users.
- Touch devices: wrap in `@media (hover: hover)` so it does not stick after tap.

**Current state differs and must change:** today the hero CTA is an ink pill +
always-lime `ArrowSquare`. Flip the rest state to lime pill + ink square, and
add a `variant="inverted"` prop to `ArrowSquare` (default `'lime'`) so the
app-scale usages elsewhere are untouched. Update `arrow-square.tsx`'s doc
comment to describe the new variant.

Apply the same inversion language to the nav's `Start applying` button so the
page has **one** hover grammar, not two.

---

## TASK 4 — Premium pass on the rest of the landing page

Think like someone who has shipped brand sites for 30 years: premium is
*restraint plus precision*, never more effects. Do all of these:

**Typography**
- `text-wrap: balance` on every `<h1>`/`<h2>`; `text-wrap: pretty` on body
  paragraphs. Kills orphans, which is the loudest amateur tell.
- Optical tracking ramp: tighten as size grows —
  `128px → -0.03em`, `72px → -0.025em`, `40px → -0.02em`, `body → -0.005em`.
  Encode as Tailwind `letterSpacing` tokens, don't scatter arbitrary values.
- `font-variant-numeric: tabular-nums` on every number, stat and mono label so
  digits don't jitter.
- Cap body measure at `68ch`.

**Motion (one vocabulary, reused)**
- Replace section `opacity+y` reveals with the **same mask language as the
  hero**: `clip-path: inset(0 0 100% 0)` → `inset(0 0 0% 0)` over 700ms with
  `EASE`, plus `y: 16→0`. The page then reads as one system.
- Hero scroll-parallax via `useScroll` + `useTransform` (Lenis is already
  running): media `y: 0 → -7%` and `scale: 1 → 1.05`, headline `y: 0 → -40px`,
  `opacity: 1 → 0` across `[0, 0.55]` of the hero's scroll range. **Clamp** the
  transforms and drive them through `useSpring({ stiffness: 120, damping: 26,
  mass: 0.4 })` so they never snap on a trackpad flick.
- Nav on scroll past 48px: `py 12 → 8`, `backdrop-blur 12 → 20`,
  background `bone/70 → bone/85`, add a `1px` `--lichen` hairline. 250ms.
- Cursor-follow light on the hero only: a `520px` radial `--lime` at
  `opacity .07`, position lerped at `0.08` toward the pointer inside a `rAF`
  loop, `mix-blend-mode: soft-light`. Desktop + `hover: hover` only.
  If it costs more than 1ms/frame, delete it.

**Surface & depth**
- Zero `box-shadow` anywhere — the token file already says this. Depth comes
  from surface steps (`--ink` → `--ink-2` → `--ink-3`) and `1px` hairlines.
- Every large radius consistent: cards `--r-card-lg (40px)`, media `--r-card
  (20px)`, controls `--r-btn (10px)`. No stray `rounded-xl`.
- One accent rule: lime appears only at micro-scale (dots, arrow square,
  active pill, focus ring, hover inversion). If lime occupies more than ~2% of
  any viewport, you have broken the system.

**Performance budget (verify, don't assume)**
- Hero must hold **58fps+** during the reveal and during scroll on a 4x-CPU-
  throttled Chrome profile. Record a Performance trace and report the numbers.
- LCP < 2.0s: the `<h1>` is the LCP element — it must not be inside the
  clipped layer's paint-blocking path. Preload the font, `font-display: swap`.
- CLS = 0: reserve the hero's height with `min-h-[92vh]` before the canvas
  mounts (already there — don't regress it).
- `content-visibility: auto` + `contain-intrinsic-size` on every section
  below the fold.
- No layout-triggering properties in any animation. Only `transform`,
  `opacity`, `clip-path`, `background-color`, `color`, `backdrop-filter`.

**Accessibility**
- Full keyboard pass: visible focus on every interactive element, logical
  order, skip-to-content link.
- `prefers-reduced-motion` honoured by every single animation added here,
  including the cursor light and parallax.
- All decorative media `aria-hidden`. The reveal must not trap focus.

---

## DELIVERABLES

1. Working code, `pnpm --filter @jobmail/client lint` and `test` both green.
2. New files: `HeroLottie.tsx`, `HeroReveal.tsx`, `public/hero/underwater.lottie`.
3. `arrow-square.tsx` extended with the `inverted` variant + updated doc comment.
4. New tokens added to **both** `index.css` and `tailwind.config.ts`.
5. A short `docs/HERO_MOTION.md`: the timing table above as implemented, the
   easing curves, and how to disable the reveal.
6. Report back: measured FPS during reveal + scroll, LCP, CLS, and the
   contrast ratios you measured for the headline over three loop frames.

## RULES

- Do not add a new animation library. framer-motion + CSS is enough.
- Do not change copy, routes, or section order.
- Do not use `transition: all`, `!important`, or inline `style` for anything
  animatable.
- Show me a diff summary per file before you start editing.
- If any spec above conflicts with the existing token system, follow the
  tokens and tell me which line you overrode and why.
