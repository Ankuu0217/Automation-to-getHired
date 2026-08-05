# Claude Code Prompt — GetHired × "Bioluminescent Laboratory" Premium Redesign

> **This supersedes `CLAUDE_CODE_REDESIGN_PROMPT.md`.** Copy everything below the
> line into Claude Code from the repo root (`Automations for getHired/`).
> Optional but recommended: keep `docs/design/DESIGN.md` (the Integrated
> Biosciences style reference) in the repo — every critical value is also
> embedded inline below, so the prompt works standalone.

---

## ROLE

You are a principal-level frontend engineer and brand designer executing a complete visual rebrand of a working product. You ship production code: typed, tested, accessible, responsive. You never break functionality for aesthetics. When the brand reference (a marketing-site style) conflicts with product-UI usability, you adapt deliberately and note the adaptation in a comment — you do not copy blindly and you do not improvise off-system.

## MISSION — two deliverables, in order

1. **Rebuild the Landing page** (`client/src/pages/Landing.tsx`) from scratch in the new design language, using the exact copy deck provided in §4 (do not invent different copy; you may fix grammar only).
2. **Reskin the entire app** (all pages + components in `client/src/`) onto the same system, adapted for product UI per §3.

Zero changes to `server/`, `shared/`, `client/src/lib/api.ts` logic, routes, react-query keys, or any handler. This is skin, structure, and copy — not behavior.

## PROJECT CONTEXT (pre-analyzed — verify fast, don't re-explore deeply)

pnpm monorepo. `client/` = React 18 + Vite 5 + Tailwind 3.4 + shadcn-style cva primitives + TanStack Query + zustand + react-router 6 + framer-motion + recharts + dnd-kit + sonner. Tokens live in `client/src/index.css` + `client/tailwind.config.ts`. Fonts load via Google Fonts `<link>` in `client/index.html`.

Product: **GetHired** — upload a LinkedIn job-post screenshot → Gemini vision extracts company/role/HR email (with per-field confidence, OCR fallback) → match analysis scores the role against your resume (0–100, threshold 40) → AI drafts a ≤180-word email in a chosen tone → user approves → sent from the user's own Gmail (OAuth) with resume attached → MX validation, 30/day cap, 10/hour throttle, 2–8 min jitter → open-pixel tracking → Kanban pipeline (Applied → Opened → Replied → Interview → Offer, ghosted after 14 days) → automatic follow-ups day 3 + day 7 that stop on reply/bounce.

Pages: `Landing`, `Login`, `Register`, `Onboarding` (3-step wizard), `Dashboard`, `NewApplication` (upload→review→send), `Pipeline` (Kanban), `Dispatches` (table), `Templates`, `Analytics`, `Settings`. Layout: fixed top Nav (no sidebar), 1200px content well.

The old theme ("Midnight Gallery": Instrument Serif italic headings, iris `#847dff` / cyan `#00b3dd` accents, obsidian `#0f1011`) is **fully retired**. Remove its fonts, its accent colors, and its legacy token aliases. What follows replaces it.

---

## §1 — THE DESIGN SYSTEM: "Bioluminescent laboratory at midnight"

Identity in one line: a darkroom laboratory — near-black canvas with a cool green undertone, restrained white typography in a **single 400 weight**, mono for anything technical, and **one** bioluminescent lime accent that only ever appears at micro-scale. Flat surfaces, zero shadows, 1px hairlines. The interface reads like a scientific instrument: calm, precise, unornamented.

### Colors (replace the entire palette in `index.css` + `tailwind.config.ts`)

| Token | Value | Role |
|---|---|---|
| `--ink` | `#222f30` | Dark canvas (hero, app bg base). Near-black w/ green undertone. NOT pure black |
| `--lime` | `#cef79e` | THE accent. Arrow buttons (40×40), 6px dots, active pills, focus rings, progress. Never a large surface, never behind body text |
| `--bone` | `#f7f7f5` | Light-section canvas (landing editorial band) |
| `--paper` | `#ffffff` | Cards on light; primary text on dark; primary button fill on dark |
| `--graphite` | `#4d5757` | Hairlines/borders on dark; secondary text on LIGHT surfaces; ghost outlines |
| `--lichen` | `#c9cbbe` | Hairlines on light surfaces only (invisible on dark — never use it there) |
| `--tissue` | `#e7e8e1` | Alternate warm card on light sections only |
| `--void` | `#000000` | Footer only |

**Product-UI extension tokens** (the reference is a marketing site; an app needs these — define them, comment them as `/* system extension */`):

| Token | Value | Why |
|---|---|---|
| `--ink-2` | `#1b2526` | App elevated-surface step below canvas (cards/nav on dark) — or use `rgba(255,255,255,0.03)` overlay; pick ONE method and use it everywhere |
| `--text-2-dark` | `#93a29f` | Secondary text on dark. (`#4d5757` on `#222f30` is ~2:1 contrast — fails WCAG; reserve `#4d5757` for borders on dark, never for text on dark) |
| `--text-3-dark` | `#6d7c7a` | Tertiary/disabled on dark, large sizes only |
| `--ok` | `#cef79e` | Success = the lime itself. Sent/replied/connected ARE the "go" signal |
| `--warn` | `#e5c07a` | Desaturated amber. Dots, text, hairlines only |
| `--danger` | `#e08d84` | Desaturated red. Bounce/failed/delete. Dots, text, hairlines, ghost-button borders only — never large fills |

### Typography — the defining rule

- **Aspekta, weight 400, for EVERYTHING** — display, headings, body, buttons-adjacent text. No bold. No semibold. No italic. **Hierarchy = size + negative tracking only.** Self-host Aspekta (MIT-licensed, github.com/ivodolenc/aspekta — install the variable font into `client/public/fonts/` with `@font-face`); if that fails, use **Inter Tight 400** from Google Fonts as the substitute. Remove Instrument Serif + Inter from `index.html`.
- **Roboto Mono 400** (already in the project — keep) for: nav items, section counters (`01`, `02`), tags, statuses, dates, metadata, table headers, button labels (uppercase), stat values. Never for headings or paragraphs.
- Tracking scales with size: `-0.001em` at 16–19px · `-0.006em` at 36–42px · `-0.02em` at 58–111px · `-0.03em` at hero sizes. Line-height: 1.3 body → 1.1 headings → 1.0 display.
- Type steps (Tailwind fontSize entries): 13/14 mono-label · 16 body · 18–19 body-lg · 24 subheading · 36 heading · 42 heading-lg · 58 display-sm · 75 display · 111 display-xl. Landing hero uses `clamp(52px, 9vw, 111px)`; 158px only on ≥1440px screens if it fits without breaking words.

### Shape, space, depth

- Radius: buttons `8px` · nav pills `12px` · cards `16–20px` · feature/large cards `40px` (landing only) · tags/counters `9999px`. Define as named tokens (`rounded-btn/nav/card/card-lg/pill`) and use ONLY the names — zero arbitrary `rounded-[…]` literals.
- Spacing on a 4px base; landing section gaps 80–120px; card padding 40px on landing, 20–24px in the app; app density stays compact but breathing.
- **Depth = zero shadows, anywhere.** Delete every `shadow-*` and the `--shadow-lg` token. Separation comes from surface color steps + 1px hairlines (`#4d5757` on dark, `#c9cbbe`/`#e7e8e1` on light). Remove the global `* { border-color }` hack; set border colors per-surface.
- Dividers: horizontal only. Never vertical rules, never double rules, never dashed.

### Accent discipline (the soul of the system — enforce ruthlessly)

Lime appears ONLY as: 40×40px arrow/action squares (radius 8px, ink arrow icon) · 6px status dots · active nav-pill fills (text flips to ink) · focus rings · thin progress indicators · chart line/fill strokes. If you're about to paint anything larger than ~48px in lime — stop, it's wrong. Buttons: **white fill + ink text on dark** (primary), ghost with `#4d5757` border (secondary), lime arrow-square (forward/next micro-CTA). Roboto Mono 13–14px uppercase labels, tracking -0.02em, compact padding (8px vert / 12–16px horiz).

---

## §2 — TOKEN MIGRATION (do this first, one commit)

1. Rewrite `client/src/index.css`: new `:root` tokens above, `@font-face` for Aspekta, kill ALL legacy aliases (`--paper-0..3` old meanings, `--ink-1..3`, `--press*`, `--rule*`, `--gray-*`, `--iris`, `--cyan`, `--pale`, `--deep`, `--orchid`, `--peri`, `--obsidian`, `--abyss`, `--graphite` old value, `--chrome`, `--sky`), kill unused utility classes (`.btn-primary`, `.btn-ghost`, `.chip-ghost`, `.mono-data`, `.reveal-atmospheric` — grep first). Keep/redefine `.micro-label` on the new tokens. Map the shadcn HSL vars (`--background`, `--card`, `--accent`, `--ring`, etc.) onto the new palette so cva primitives inherit it.
2. Rewrite `client/tailwind.config.ts` to expose exactly: the 8 brand colors + 6 extension tokens, the two font families, the type scale with per-size tracking/leading, the named radii, and the existing keyframes (`fade-in`, `fade-in-up`, `border-trace` — keep border-trace, restyle its stroke to lime).
3. `client/index.html`: title/meta stay, fonts swap, `<html class="dark">` stays (app is dark-canvas by default; landing flips sections itself).

## §3 — PRODUCT-UI ADAPTATION RULES (app screens)

- App canvas `--ink`; nav + cards on `--ink-2` (or the single chosen overlay method) + 1px `#4d5757` hairline; text `#ffffff` / `--text-2-dark` / `--text-3-dark`. Light sections do NOT appear inside the app — the light flip is a landing-only device.
- Primary buttons white-fill/ink-text; the NewApplication wizard's "next step" affordances become the signature 40×40 lime arrow-square. Fix the two broken hover utilities while you're in `button.tsx` (`hover:opacity-92` → `hover:opacity-[0.92]`-style valid classes; `hover:bg-pure/8` → `/[0.08]` equivalents on new tokens).
- ONE focus ring everywhere: `outline: 2px solid var(--lime); outline-offset: 2px` (or ring-2 ring-lime) on Button, Input, Select, Textarea, Switch, nav links, Kanban cards, table rows.
- Inputs: bg transparent or `--ink-2`, 1px `#4d5757` border, radius 8px, focus border+ring lime. Make this the DEFAULT inside `ui/input.tsx`/`textarea`/`select` and delete the ~15 per-instance override strings across pages.
- Statuses (`StatusLabel`, `Stamp`-style chips, Pipeline badges): 6px dot + Roboto Mono uppercase label. ok=lime, warn=amber, danger=red, neutral=`--text-2-dark` — differentiate all 12 states (currently 5 share one gray).
- Charts (`ActivityChart`, Analytics funnel/trend): lime line/bars on ink, `#4d5757` grid hairlines, mono axis labels, tooltip = ink-2 card with hairline. All colors via `var(--…)` — zero hex literals in TSX.
- Kanban: hairline-bordered columns, mono column headers `01 APPLIED · 4`, cards radius 16px, drag state = lime hairline.
- Motion: 150–250ms fades/slides only; keep the `border-trace` draw (now lime) as the one signature flourish; landing entrances ≤ 600ms; respect `prefers-reduced-motion` globally.
- Replace every `window.confirm()` (Settings delete-account, Templates delete, Gmail disconnect) with a themed confirm dialog built on the sheet pattern: ink-2 surface, hairline, danger ghost button.
- Delete dead components (`Stamp.tsx`, `Masthead.tsx`, `DraftingGuides.tsx`, `pages/ComingSoon.tsx`) after grep-proving zero imports. Fix Onboarding's phantom `fadeInUp` inline animation → `fade-in-up` utility.
- Mobile: add a hamburger + slide-down menu to `Nav.tsx` (app links are currently `hidden md:flex` with NO mobile path — Templates/Analytics/Settings unreachable on phones); add `/dispatches` to the nav; rename "Wire Board" → "Pipeline" everywhere; make `Ledger.tsx` responsive (its fixed 6-col grid overflows — collapse to stacked rows or scroll-wrap under `md`); let the Dashboard stat strip wrap.
- Extract ONE `EmptyState` component (heading 36px Aspekta + mono caption + optional arrow-square CTA) and use it in the ~5 places that duplicate empty-state copy.
- A11y: MatchDial gets `role="meter"` + `aria-valuenow` + label; ProcessingSequence gets `aria-live="polite"`; Ledger rows stop nesting buttons inside buttons.

## §4 — LANDING PAGE: EXACT COPY DECK + STRUCTURE

Rebuild `Landing.tsx` as alternating full-bleed bands, content well 1200px. Use THIS copy verbatim. All-caps strings are Roboto Mono micro-labels; sentence text is Aspekta 400. Every headline is period-terminated. No exclamation marks anywhere. No fabricated statistics anywhere.

**NAV (transparent on ink, not sticky):** left wordmark `GetHired` (Aspekta 24px). Right, mono 13px pills: `METHOD` · `PLATFORM` · `LOG IN` · filled white `START APPLYING →`. Active pill = lime fill, ink text.

**BAND 1 — HERO (ink canvas, ~90vh, asymmetric left):**
- Mono eyebrow with 6px lime dot: `COLD OUTREACH, INSTRUMENTED`
- H1, clamp(52px→111px), white, tracking -0.02em, two lines:
  `From screenshot`
  `to sent.`
- Sub (24px, `--text-2-dark`, max-w 560px): `GetHired reads a LinkedIn job post from a screenshot, writes a personalized email against your resume, and sends it from your own Gmail — capped, tracked, and followed up on schedule.`
- CTA row: filled white `START APPLYING` + ghost `SEE THE METHOD` + 40×40 lime arrow-square (scrolls to Band 2).
- Bottom hairline strip, mono 13px, `--text-2-dark`, four items separated by generous gaps: `≤ 180 WORDS PER EMAIL` · `30 SENDS / DAY, CAPPED` · `FOLLOW-UPS D+3 · D+7` · `SENT FROM YOUR GMAIL`
- Massive negative space between H1 and sub — minimum 160px on desktop. No hero image. The typography is the image.

**BAND 2 — THE METHOD (ink, four numbered blocks, 01–04, each: pill counter + 36–42px heading + 18px body max-w 520px, separated by hairlines, 100px gaps):**
- `01 / CAPTURE` — H: `Drop in a screenshot of any job post.` B: `Vision AI extracts the company, the role, the location, and the recruiter's address — with a confidence score on every field. Low confidence gets flagged, not guessed.`
- `02 / COMPOSE` — H: `An email written against your resume.` B: `Match analysis scores the role from 0 to 100 against your skills and surfaces the gaps. The draft runs under 180 words, in your tone. Nothing sends without your approval.`
- `03 / DISPATCH` — H: `Sent from your Gmail. Not ours.` B: `OAuth-connected sending with your resume attached. Addresses are MX-validated, timing is jittered, volume is capped — the guardrails that keep you out of the spam folder.`
- `04 / TRACK` — H: `The pipeline keeps the ledger.` B: `Opens recorded to the minute. Follow-ups fire on day 3 and day 7, and stop the moment a reply lands. Fourteen days of silence marks it ghosted — recorded, not forgotten.`

**BAND 3 — THE PLATFORM (flip to bone-white; mono section label `THE PLATFORM` with lime dot; white cards radius 20px, 40px padding, lichen hairlines, 2×2 grid, each card: 24px heading + 18px graphite body + mono `EXPLORE →` link):**
- `Match analysis.` — `A score against your profile before you spend a send. Below 40, the system tells you to think twice.`
- `Templates with evidence.` — `Every template carries its own sent, opened, and replied counts. Keep what works. Retire what doesn't.`
- `Deliverability guardrails.` — `Daily caps, hourly throttles, two-to-eight-minute jitter, MX checks. Volume is easy. Landing in the primary tab is the discipline.`
- `A pipeline, not a spreadsheet.` — `Applied, opened, replied, interview, offer. Drag the cards, keep the notes, mark the replies — the whole search on one board.`

**BAND 4 — ASSURANCE STRIP (bone-white continues, single hairline-framed row, mono 13px graphite):** `YOUR GMAIL, YOUR DATA` · `AES-256 TOKEN ENCRYPTION` · `DELETE EVERYTHING, ANY TIME` · `NO SEND WITHOUT APPROVAL`

**BAND 5 — CLOSE (ink):** H2 58–75px white: `Your next role is one send away.` + filled white `START APPLYING` + 40×40 lime arrow. Below, mono 13px `--text-2-dark`: `FREE WHILE IN BETA — GMAIL CONNECT TAKES TWO MINUTES.`

**FOOTER (pure `#000`):** wordmark left; mono links `METHOD · PLATFORM · LOG IN · REGISTER`; right: `BUILT QUIETLY — GETHIRED © 2026`.

Delete the old hero's `AiPromptInput` (it promised URL paste — the product takes screenshots), the `sky`/`chrome` gradients, the fabricated `Response rate 18%` stat, and the duplicate in-file Header in favor of `Nav variant="public"`.

## §5 — APP SCREEN ORDER

Migrate in this order, one commit each: tokens+primitives → Nav/AppLayout → Landing (§4) → Dashboard → NewApplication (keep every state: confidence banners, duplicate/low-match warnings, failure panels for `MX_INVALID_DOMAIN`/`RESUME_MISSING`/`GMAIL_NOT_CONNECTED`/`SEND_FAILED` — restyle only) → Pipeline → Analytics → Templates → Settings → Onboarding → Login/Register → Dispatches → sweep for stragglers.

Auth + Onboarding: ink canvas, centered 400px hairline card, mono step counters (`STEP 01 / 03`), lime arrow-square as the "continue" affordance.

## §6 — VERIFY (all must pass before done)

1. `pnpm --filter @jobmail/client lint` → zero TS errors.
2. `pnpm --filter @jobmail/client test` → suites pass (update `button.test.tsx` snapshots/classes if variants changed).
3. `pnpm --filter @jobmail/client build` → clean.
4. `grep -rn "847dff\|00b3dd\|0f1011\|Instrument\|window.confirm\|opacity-92\|bg-pure/8\|shadow-lg\|rounded-\[" client/src` → zero hits (chase every survivor).
5. Grep TSX for hex colors (`#[0-9a-fA-F]{3,6}`) → only allowed inside the token files.
6. Dev server + Playwright (preinstalled): screenshot every route at 375px and 1280px. Check: mobile nav opens and reaches every page; nothing overflows; hero clamps; focus ring visible by keyboard-tabbing through Landing, NewApplication, Pipeline.
7. Contrast spot-check: `--text-2-dark` on `--ink` ≥ 4.5:1; mono labels ≥ 4.5:1 at their sizes; lime-on-ink for text used only at ≥ 14px mono.

## WORKING RULES

- Small commits, prefix `design:`. Anything deleted must be grep-proven unused first.
- The reference's Do/Don't list is law: no bold, no italic, no second accent, no shadows, no pure-black content surfaces (black = footer only), no lime on large surfaces, warm neutrals (`#c9cbbe`, `#e7e8e1`) never on dark.
- When the law conflicts with usability (contrast, status colors, density), apply §1's extension tokens and leave a one-line `/* system extension: reason */` comment.
- If any change seems to require touching server code or API shapes — stop and ask.
