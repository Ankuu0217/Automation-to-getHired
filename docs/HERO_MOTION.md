# Hero motion — the load intro + scroll, as implemented (v2)

The landing hero is a GPU-decoded looping `<video>` (not a per-frame canvas) so
it costs ~0 main-thread time during scroll. On load, the copy enters first and
the **media reveals last**; on scroll, a subtle parallax runs off Lenis.

Files:

- `client/src/components/HeroMedia.tsx` — the `<video>` + legibility stack + pause hygiene.
- `client/src/lib/heroIntro.ts` — the play-once-per-session gate.
- `client/src/pages/Landing.tsx` — the intro orchestration, the Lenis-driven parallax, the nav condense, the cursor light, the CTA.

## Why it's smooth

Smoothness = never software-painting a full-bleed surface during scroll.

- The hero is a `<video>` (decode/compose off the main thread, composited like an image). No WASM canvas, no per-frame repaint.
- The `.hero-mesh::before` 24s infinite gradient animation was **removed** (a full-bleed animating paint layer).
- **One rAF:** Lenis owns the scroll loop. Every scroll-linked value is read from Lenis's own `on('scroll')` callback into a `useMotionValue` — no `useScroll`, no second scroll listener.
- The nav uses `backdrop-blur` only in the calm top 48px; past 48px it goes near-opaque (`bg-bone/92`) and drops the blur, so it never re-samples moving video.
- Below-fold sections use `content-visibility: auto` so they don't paint/lay-out during scroll.
- Only compositor/paint-safe properties animate anywhere: `transform`, `opacity`, `clip-path`, `filter`, `background-color`, `color`, `backdrop-filter`. **No** `width/height/top/left/margin/padding`.

## Load choreography (motion allowed, first visit of the session)

The headline leads; the media reveals last. Easing is `EASE = cubic-bezier(0.16, 1, 0.3, 1)` throughout.

| Order | Element | Enter | Start (s) | Dur (s) |
|------:|---------|-------|----------:|--------:|
| 1 | `<h1>` "From screenshot / to sent." | fade-rise `y 28→0`, per-line stagger 90ms | 0.15 / 0.24 | 0.7 |
| 2 | Eyebrow (lime dot + `COLD OUTREACH…`) | fade-rise `y 20→0` | 0.55 | 0.6 |
| 3 | Nav pill (whole `<header>`) | fade `opacity 0→1`, `y 8→0` | 0.85 | 0.5 |
| 4 | Subparagraph + CTA cluster | fade-rise `y 24→0`, stagger 90ms | 1.10 / 1.19 | 0.6 |
| 5 | **Hero media (video stack)** | reveal LAST — `clip-path: inset(0 0 100% 0)` → `inset(0 0 0% 0)` **+** `scale 1.08→1`, `opacity 0→1` | 1.35 | 0.9 |

- The video **mounts and plays immediately** behind its clip mask, so revealing the container has no play-pop.
- `document.body` overflow is locked for the intro and released when the media (step 5) finishes (~2.4s), so nobody scrolls mid-sequence.
- `will-change: clip-path, transform, opacity` is set on the media wrapper only while it reveals, and removed on completion.

## Scroll (hero parallax)

Driven through `useSpring(progress, { stiffness: 120, damping: 26, mass: 0.4 })` off the Lenis scroll value, all clamped:

| Element | Property | Range | Over hero progress |
|---------|----------|-------|--------------------|
| Video | `y` | `0 → -6%` | `[0, 0.6]` |
| Video | `scale` | `1 → 1.06` | `[0, 0.6]` |
| Headline | `y` | `0 → -32px` | `[0, 0.5]` |
| Headline | `opacity` | `1 → 0` | `[0, 0.5]` |

Nav condense past 48px: `bg-bone/70 → bg-bone/92`, `backdrop-blur 12px → 0`, over 250ms (padding stays constant — animating it would be layout-triggering).

## Play-once & reduced motion

- The intro plays **once per browser session**, gated on `sessionStorage['gh:hero-intro']`. Client-side navigations back to `/` do not replay it; open a new tab to see it again.
- `prefers-reduced-motion: reduce`: all final states render with a single 200ms opacity fade — no clip/scale, no scroll lock, no parallax, no cursor light. The video shows its **poster** (does not autoplay).

## How to disable the intro

1. **Per session, at runtime** — `sessionStorage.setItem('gh:hero-intro', '1')` before the hero mounts. The hero renders directly in its settled state.
2. **In code, permanently** — in `Landing.tsx` change `const [intro] = useState(() => heroIntroPending());` to `const [intro] = useState(false);`.
3. **System-wide** — OS "Reduce motion" disables it (and every other animation added here) automatically.
