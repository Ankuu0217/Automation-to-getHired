# Claude Code Prompt — integratedbio-grade footer, feature blocks & feature showcase (v3)

> Run from the repo root `/Users/ankitsingh/Automations for getHired`.
> Built against the real code: React 18 + Vite + TS + Tailwind 3 +
> framer-motion 12 + Lenis. Landing page: `client/src/pages/Landing.tsx`.
> Tokens: `client/src/index.css` + `client/tailwind.config.ts`. Signature
> square: `client/src/components/ui/arrow-square.tsx`. Assumes the hero v2
> work (video hero, one motion vocabulary, `EASE = [0.16,1,0.3,1]`) is done —
> reuse that same motion language here.

You are a principal product designer + front-end engineer — the kind
Anthropic pairs with Claude to ship award-grade marketing sites. The bar is
integratedbio.com (Awwwards SOTD by Accomplice LLC). Match its *structure and
craft*, but render everything in **GetHired's existing token system** — do not
paste integratedbio's hexes; our tokens already mirror them
(`--ink #222f30`, `--lime #cef79e`, `--bone #f7f7f5`, `--paper #fff`,
`--graphite #4d5757`, `--lichen #c9cbbe`, `--void #000`, radii
`--r-btn 10 / --r-arrow 14 / --r-card 20 / --r-card-lg 40 / --r-pill`).

**Global rules (enforced everywhere below):**
- Never hardcode a hex — use the CSS tokens / Tailwind aliases.
- Single-weight Aspekta; hierarchy via size + tracking, never font-weight.
- Roboto Mono (`MONO_13` in Landing.tsx) for all labels, indices, dates.
- Lime only at micro-scale (dots, arrow square, tag chips, active states).
- Zero `box-shadow`. Depth = surface steps + 1px hairlines only.
- Animate only `transform / opacity / clip-path / color / background-color`.
- No copy invented for features — pull real feature facts from the actual
  page components (paths listed in TASK 3). Keep marketing copy tight.
- Show me a per-file diff summary before editing. `lint` + `test` stay green.

---

## TASK 1 — Footer: replicate integratedbio.com's footer exactly (in our tokens)

Replace the current small `<footer className="bg-void">` block entirely with a
full-bleed **cinematic footer**. Reference anatomy (top → bottom):

1. **Full-width media panel**, min-height `~78vh`, `--r-card-lg (40px)` rounded
   **top** corners (the bone "close" section above it tucks into these
   corners — set the section above to have no bottom radius; the footer's
   rounded top reads as an overlap). Background = the hero still
   `/hero/underwater-poster.jpg` with `object-fit:cover`, over `--void`, with
   the **same brand stack as the hero**: `--ink/45` tint +
   `filter: saturate(.9) hue-rotate(-12deg)` + a top-down scrim
   `linear-gradient(to bottom, rgba(13,26,23,.7), rgba(0,0,0,.35) 40%,
   rgba(0,0,0,.72))` so text is legible and the giant wordmark reads. **Do not
   use a second `<video>` here** — a static poster keeps the footer cheap; the
   only moving media on the page stays the hero.

2. **Upper row** (padded `px-6`, max-w `1200px`, centered), `flex` between:
   - **Left:** the reuse of the closing line — a large headline
     `text-display-sm` white, max-w ~`560px`:
     *"Your next role is one send away."* Under it, the **inverted CTA cluster**
     from the hero (`group/cta`): ink pill `Start applying` + lime→ink arrow
     square, linking to `/register`.
   - **Right:** two link columns with mono uppercase muted headers and white
     links below, each column preceded by a `1px --graphite` vertical hairline:
     - `NAVIGATE` → Platform (`#platform`), Company (`#company`),
       How it works (`#how`)
     - `CONNECT` → LinkedIn, X  *(use real URLs if present in Settings/repo;
       otherwise `#` placeholders with a `TODO(social)` comment — do not fake
       links)*
   - **Far right, top:** a circular **scroll-to-top** button — `size-14`,
     `rounded-pill`, `1px` bordered (`border-graphite`, hover
     `border-text-3-dark`), containing an up-arrow (`ArrowUp`, `strokeWidth 1.5`).
     On click, `lenisRef.current.scrollTo(0)` (fall back to
     `window.scrollTo({top:0,behavior:'smooth'})`). `aria-label="Back to top"`.

3. **Giant wordmark**: the text `GetHired` spanning near-full width along the
   footer's bottom, white, `font-normal`, tracking `-0.03em`,
   `font-size: clamp(84px, 19vw, 320px)`, `line-height:.9`, letting the
   descender/baseline **bleed a few px off the bottom edge** (overflow hidden on
   the panel). This is the hero-scale signature moment — it must feel huge and
   confident, not decorative.

4. **Baseline strip** (inside the panel, above the wordmark or pinned bottom-
   left over it): mono `text-text-3-dark`
   *"© 2026 GETHIRED · ALL RIGHTS RESERVED."* left, and a small
   *"BUILT QUIETLY"* or the beta note right.

**Motion:** on scroll into view (`whileInView, once`), the wordmark rises with
a `clip-path: inset(0 0 100% 0)` → `inset(0 0 0 0)` reveal + `y: 40→0`, 900ms,
`EASE`; the columns and CTA fade-rise staggered 80ms *before* the wordmark.
Respect `prefers-reduced-motion`.

---

## TASK 2 — Restyle the PLATFORM pillars into 3 full-bleed feature blocks ("3-image" layout)

The current `BAND 02 — THE PLATFORM` renders `PILLARS` as three stacked rows
with `border-t` dividers. Rebuild that grid as integratedbio's **three
edge-to-edge colour blocks** (screenshot ref: the "Aging datasets / Drug
design / AI" band).

- One **full-bleed row** (break out of the `max-w-[1200px]` container to the
  viewport edges), `grid md:grid-cols-3`, **no gaps**, each cell **equal width,
  min-height `~clamp(420px, 42vw, 560px)`**.
- The three cells carry the **alternating surface rhythm** — this is the whole
  point of the pattern:
  - **01 · CAPTURE** → `bg-lime text-ink`
  - **02 · COMPOSE** → `bg-ink text-paper` (use `--ink-2` if it needs to sit a
    step off the page bg)
  - **03 · DISPATCH** → `bg-bone text-ink`
- Each cell is a `flex flex-col justify-between p-8 md:p-10`:
  - **Top row:** a **line-art icon** (top-left, ~64px, `stroke:currentColor`,
    `stroke-width:1.25`, `fill:none`) + the mono index `01.` top-right.
    Draw three original single-stroke marks that read as the step (e.g.
    capture = concentric aperture/scan rings; compose = overlapping document
    glyphs; dispatch = radiating send/paper-plane lattice). Keep them abstract
    and technical like integratedbio's sunburst / hexagon / lattice — **not**
    literal emoji-style icons.
  - **Bottom block:** `title` (`text-heading`, tracking `-0.02em`) + `body`
    (`text-body-lg`, the block's secondary text token). Keep PILLARS' existing
    titles/bodies — do not rewrite them.
- The one accent rule still holds: on the lime and bone cells the icon/text are
  ink; on the ink cell they're paper. No lime *inside* the lime cell.
- Keep the section's intro (`h2` "Screenshots in…" + subhead) above the band.
- **Motion:** the three cells reveal on scroll with a **horizontal wipe** —
  `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` + slight `scale 1.02→1`,
  staggered 90ms L→R, `EASE`, `once`. Reduced-motion → plain fade.
- **Hover microinteraction:** the block's icon does a 200ms
  `translate`/`rotate(2deg)` nudge and the index brightens; no layout shift.

---

## TASK 3 — New section: "Everything after the send" — feature showcase with notched cards

Add a new section (id `#features`, place it after the PLATFORM blocks) that
**showcases the app's real, newly-built features**. First **read these page
components and write accurate, specific copy** from what they actually do — do
not invent capabilities:

| Route | File | Feature (working title) |
|---|---|---|
| `/apps/batch` | `pages/BatchUpload.tsx` | **Batch capture** — drop many screenshots, AI reads them all at once |
| `/pipeline` | `pages/Pipeline.tsx` | **Pipeline board** — every application on one drag-to-move board |
| `/analytics` | `pages/Analytics.tsx` (+ `components/ActivityChart.tsx`, `lib/streak.ts`) | **Analytics & streaks** — opens, replies, response time, activity |
| `/contacts` | `pages/Contacts.tsx` | **Recruiter contacts** — a deduped, MX-checked address book |
| `/dispatches` | `pages/Dispatches.tsx` | **Dispatch log & follow-ups** — day-3 / day-7 automation, stops on reply |
| `/templates` | `pages/Templates.tsx` | **Templates & tone** — reusable drafts tuned to your voice |

Pick the **strongest 6** (above) for a `grid md:grid-cols-3` of **notched
cards**. Add the `NewApplication` core flow as an optional wide **featured
card** on top (image-left / copy-right, like integratedbio's featured
publication) if it strengthens the section.

**Card anatomy (integratedbio's signature notched card):**
- Rounded card, `--r-card (20px)`, `1px` hairline (`--lichen` on light cards,
  `--graphite` on dark), surface = alternating `paper` / `ink-2` / muted-green
  (`--ink-3`) across the grid for rhythm — **not** all the same.
- **Top-left tag chip:** a `6px` lime square + mono label
  (e.g. `PIPELINE`, `ANALYTICS`). **Top-right:** a mono meta (a short stat or
  `NEW`), `tabular-nums`.
- **Title** (`text-subheading`) + **body** (`text-body-lg`, secondary token),
  and a mono `EXPLORE →` affordance bottom-left.
- **The signature detail — a concave notch at the bottom-right corner** that an
  arrow square nests into (`ArrowSquare`, inverted variant, `56px`). The card's
  corner curves *inward* around the button with an ~`8px` gap.

**Notch recipe** (use this; it's the crisp, shadow-free way integratedbio does
it — a CSS mask, no SVG per-card):

```css
.notch-card{
  --sq: 56px;                              /* nested square */
  --gap: 8px;                              /* breathing gap */
  --cut: calc(var(--sq) + var(--gap)*2);   /* cut-out region */
  --cr: 20px;                              /* card outer radius */
  --nr: 16px;                              /* concave inner radius */
  border-radius: var(--cr);
  -webkit-mask:
    /* body minus the bottom-right cut square */
    conic-gradient(from 90deg at var(--cut) var(--cut), #0000 25%, #000 0)
      100% 100% / var(--cut) var(--cut) no-repeat,
    linear-gradient(#000 0 0) 0 0 / 100% calc(100% - var(--cut)) no-repeat,
    linear-gradient(#000 0 0) 0 0 / calc(100% - var(--cut)) 100% no-repeat,
    /* round the two concave inner corners */
    radial-gradient(var(--nr) at calc(100% - var(--cut)) calc(100% - var(--cut)), #000 98%, #0000) 0 0/100% 100% no-repeat;
  mask: /* repeat the same four layers for the un-prefixed property */ ;
}
```

Position `ArrowSquare` `absolute bottom-2 right-2`. **Acceptance:** screenshot
the card and confirm the corner reads as a smooth concave cut with the square
sitting flush in it, and that the mask holds at 3 card widths (mobile 1-col,
tablet 2-col, desktop 3-col). If the mask fights the hairline border, move the
border to an inner `::before` inset ring that shares the same mask. **Fallback
only if the mask can't be made crisp:** float the square overlapping the corner
with a `--gap` ring of page-colour — but try the mask first.

**Motion:** cards reveal with the page's mask-rise
(`clip-path: inset(0 0 100% 0)` → `inset(0 0 0 0)` + `y16→0`, `once`, 90ms
stagger). Card hover: `translateY(-2px)`, hairline brightens to
`--text-3-dark`, the nested square runs its inverted colour flip (320ms) — one
hover grammar with the rest of the site.

---

## TASK 4 — Cohesion, accessibility, performance

- **Type polish** (if not already from v2): `text-wrap:balance` on headings,
  `pretty` on body; `tabular-nums` on every stat/date; body measure ≤ `68ch`.
- **A11y:** every card/link keyboard-reachable with visible `.focus-ring`;
  logical tab order; line-art icons and the poster are `aria-hidden`; the
  scroll-to-top button is a real `<button>` with a label; colour contrast AA
  (4.5:1) on every text-over-surface combination — **check the bone text on the
  lime block and white text over the footer poster explicitly**.
- **Perf:** `content-visibility:auto` + `contain-intrinsic-size` on the new
  sections; the footer poster is a single optimized image with
  `loading="lazy"` `decoding="async"`; the full-bleed blocks must not trigger
  horizontal scroll (`overflow-x` clean at 320px). No new dependency.
- **Reduced motion:** every reveal degrades to a ≤200ms opacity fade.

---

## DELIVERABLES

1. Rewritten footer, restyled PLATFORM blocks, new `#features` section — all in
   `Landing.tsx` (extract a `FeatureCard`/`FeatureBlock` component if it keeps
   the file clean).
2. Line-art icon set as inline SVG components (3 for blocks, 6 for features) —
   original, single-stroke, technical.
3. `arrow-square.tsx` — confirm the `inverted` variant from v2 exists (add if
   not); use it in the notch cards and footer CTA.
4. Any new tokens (icon stroke, notch vars) in **both** `index.css` and
   `tailwind.config.ts`.
5. `lint` + `test` green. Report: the contrast ratios you measured for
   (a) ink text on lime block, (b) white headline over footer poster, and a
   screenshot of one notch card at desktop width.

## RULES

- Do not change routes or the app; this is the marketing landing only.
- Do not rewrite the existing PILLARS/close copy; only restyle + add.
- No `transition:all`, no `!important`, no `box-shadow`, no invented features.
- If any spec conflicts with the token system, follow the tokens and tell me
  which line you overrode and why. Show diffs before editing.
