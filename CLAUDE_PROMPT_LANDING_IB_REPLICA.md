# Claude Code Prompt — GetHired Landing Page, built as a 1:1 replica of integratedbio.com

> Paste everything below the line into Claude Code from the repo root
> (`Automations for getHired/`). The design token files already live at
> `docs/design/` (DESIGN.md, tokens.json, theme.css, variables.css) — read them.
> This prompt was written after inspecting integratedbio.com live in Chrome;
> the observed layout, fonts, colors, and motion are described literally below,
> so it is self-contained.

---

## ROLE

You are a principal frontend engineer + motion designer with deep Webflow/GSAP-era craft, now working in React. Your job: rebuild `client/src/pages/Landing.tsx` (and only the landing surface + its tokens/fonts) so it looks and *moves* like **integratedbio.com** — the same floating pill nav, the same image-rich hero, the same single-weight Aspekta typography, the same lime arrow accent, the same alternating dark→light editorial bands, the same scroll-reveal motion — but with **GetHired's product content** (copy deck given verbatim in §5). Match the *reference's craft*, not its words.

Do not touch `server/`, `shared/`, `client/src/lib/api.ts`, routes, or react-query. This task is the landing page + the design tokens/fonts it depends on. (A separate prompt reskins the app screens; this one is laser-focused on the landing so it comes out pixel-tight.)

## §1 — WHAT THE REFERENCE ACTUALLY LOOKS LIKE (observed live — replicate this)

**Nav** — a *floating rounded pill*, not a full-width bar. Frosted near-white/pale-green translucent capsule, centered-right, ~12px radius on the group, sitting ~24px from the top over the hero image. Left of it (outside the pill, over the image) sits the logo: a thin-line looped/infinity mark + wordmark in white. Inside the pill: three Roboto-Mono uppercase text links (`PLATFORM`, `COMPANY`, `NEWSROOM`) then one dark-filled rounded button (`WORK WITH US`, ink fill `#222f30`, white mono text). Letter-spacing on the mono is loose-ish, ~0.02em, 13px.

**Hero** — full-bleed, ~92vh. The background is a large **abstract organic 3D render**: dark forest-green folds with a bronze/copper light-streak curving through it, soft and glossy, filling the entire hero. Over it:
- Top-left, huge white headline in **Aspekta 400** (humanist sans, double-story `a`/`g`, flat-top `t`): *"Engineering the future of aging medicine."* — two lines, tight line-height (~1.02), negative tracking (~-0.02em), clamps roughly 72→128px. Period-terminated.
- Bottom-left, a smaller white/near-white line (~19px Aspekta): the descriptive subtext.
- Bottom-right, a pair: a dark rounded pill button `DISCOVER OUR PLATFORM` (ink fill, white mono uppercase) immediately followed by a **lime `#cef79e` rounded square (~56px, ~14px radius) containing a dark `→` arrow**. This lime arrow square is the signature accent.

**Body bands** (top→bottom): an intro "what we do" band with a `01 / 03` mono counter + a large muted reflective statement; a "platform" band with a headline + three pillars each ending in an arrow; a "company" band; a "newsroom" band that flips to the **bone-white** canvas with white editorial cards (image-left, text-right, big radius, hairline border, mono `PUBLICATIONS` tag with a 6px lime dot, date, title, `READ ARTICLE →`); then the **footer on pure black `#000`**.

**Type system** — everything display/body is Aspekta at a *single* 400 weight; hierarchy is size + tracking only (no bold, ever). Roboto Mono 400 for nav, counters, tags, dates, button labels, metadata.

**Palette** — `--ink #222f30` (dark bands, not pure black), `--lime #cef79e` (accent, micro only), `--bone #f7f7f5` (light bands), `--paper #fff` (cards), `--graphite #4d5757` (borders/secondary text on light), `--lichen #c9cbbe` (hairlines on light), `--void #000` (footer). Zero shadows anywhere — depth is surface-color + 1px hairlines only.

**Motion** — smooth momentum scrolling; on scroll, text and cards **fade + rise ~24px into place** as they enter the viewport (staggered for lists); the hero headline fades/rises on load; arrow buttons nudge their `→` right on hover; the lime arrow square lifts subtly on hover. Nothing bounces, nothing spins — the motion is calm and editorial, 400–700ms, soft easing.

## §2 — FONTS (do first)

- **Aspekta 400** — self-host. Download the Aspekta variable/400 web font (SIL/MIT-style free license, from the official Aspekta repo) into `client/public/fonts/aspekta/`, add `@font-face` (weight 400 only, `font-display: swap`). If for any reason it can't be fetched at build time, fall back to **Inter Tight 400** via Google Fonts — but prefer real Aspekta, its letterforms are the reference's fingerprint.
- **Roboto Mono 400** — already loaded in `client/index.html`; keep it.
- Remove Instrument Serif and plain Inter from `index.html` (old theme fonts). Set `--font-display`/`--font-mono` accordingly.

## §3 — TOKENS (reuse docs/design)

Read `docs/design/tokens.json` + `DESIGN.md` and put these into `client/src/index.css` `:root` and `client/tailwind.config.ts` (this landing needs them; the app-wide migration can follow later):

```
--ink:#222f30;  --lime:#cef79e;  --bone:#f7f7f5;  --paper:#ffffff;
--graphite:#4d5757;  --lichen:#c9cbbe;  --tissue:#e7e8e1;  --void:#000000;
--text-2-dark:#93a29f;  /* system extension: readable secondary text on ink; #4d5757 fails contrast on dark, keep it for borders only */
```

Radii tokens: `--r-btn:10px; --r-nav:14px; --r-card:20px; --r-card-lg:40px; --r-arrow:14px; --r-pill:9999px`. Type scale + tracking exactly per DESIGN.md (`-0.001em` body → `-0.03em` hero). No shadow tokens.

## §4 — BUILD APPROACH

- Rebuild `Landing.tsx` from scratch as a composition of section components (put small local subcomponents in the same file or a `client/src/components/landing/` folder — your call, keep it clean). Use **framer-motion** (already a dependency) for the scroll reveals via `whileInView`/`useInView` with `viewport={{ once: true, margin: '-15%' }}`, `initial={{opacity:0, y:24}}`, `whileInView={{opacity:1, y:0}}`, `transition={{duration:0.6, ease:[0.16,1,0.3,1]}}`; stagger lists with a parent `staggerChildren:0.08`.
- Smooth momentum scroll: add **Lenis** (`npm i lenis`) initialized once in `Landing.tsx` (or app root) with cleanup on unmount; if you'd rather not add a dep, `html{scroll-behavior:smooth}` is an acceptable fallback — but Lenis matches the reference feel and is tiny.
- Respect `prefers-reduced-motion`: when set, disable Lenis and render all `whileInView` elements at their final state (no transform).
- Reuse the existing `border-trace` keyframe idea only if it fits; otherwise the fade-rise reveal is the primary motion.
- The nav on landing is the floating pill described in §1 — build it as a landing-local component (or `<Nav variant="public" floating />`); it is NOT the app's top bar. Links route: `PLATFORM`→`#platform`, `COMPANY`→`#company`, `NEWSROOM`→`#how` (anchor scroll), `WORK WITH US`/`START APPLYING`→`/register`, `LOG IN`→`/login`.

## §5 — HERO IMAGE (the one asset to get right)

The reference's hero is a bespoke abstract organic render. Do this, in priority order:
1. **Preferred:** generate/produce one abstract render — dark forest-green (`#222f30`→`#0d1a17`) folds with a single warm bronze/copper light-streak (`#b98a5e`-ish) curving through, glossy, no text, 1600×1200, exported to `client/public/hero/render.webp`. If you have an image tool available, make it; otherwise leave a clearly-named placeholder file and a `TODO(asset)` comment.
2. **Guaranteed-good fallback (build this regardless, behind the image):** a CSS/SVG **animated mesh gradient** in the same palette — layered radial-gradients in ink-green + one bronze bloom, very slow drift (`@keyframes ~24s` translating the blooms a few percent), sitting full-bleed behind the hero content with a subtle dark scrim at the bottom-left so the headline and subtext stay legible. This must look premium on its own so the page never depends on a missing image.
- Either way, overlay a bottom-left→top gradient scrim (`linear-gradient(to top, rgba(15,20,18,.75), transparent 55%)`) for text contrast.

## §6 — EXACT COPY DECK (GetHired content — use verbatim; fix grammar only, invent nothing, no fake stats, no "!" )

**NAV pill:** links `PLATFORM` · `COMPANY` · `HOW IT WORKS` · dark button `START APPLYING`. Logo wordmark `GetHired` with a thin-line loop mark to its left.

**HERO**
- Eyebrow (mono 13px, white, 6px lime dot prefix): `COLD OUTREACH, INSTRUMENTED`
- Headline (Aspekta, clamp 72→128px, white, two lines):
  `From screenshot`
  `to sent.`
- Subtext (Aspekta ~19px, near-white, bottom-left, max-w 520px): `We read a job post from a screenshot, write a personalized email against your resume, and send it from your own Gmail — capped, tracked, and followed up on schedule.`
- CTA (bottom-right): dark pill `DISCOVER THE METHOD` + lime arrow-square `→` (scrolls to `#platform`).

**BAND 01 — WHAT WE DO (ink):** mono counter `01 / 03`. Big muted statement (Aspekta 42px, `--text-2-dark`, max-w 720px): `A job search is a systems problem — dozens of roles, dozens of recruiters, every message personal. GetHired is built to run that pipeline without losing the human in it.`

**BAND 02 — THE PLATFORM (`#platform`, ink):**
- Headline (Aspekta 58px, white): `Screenshots in. Personalized, tracked outreach out.`
- Sub (19px `--text-2-dark`, max-w 620px): `The platform turns a screenshot into a sent, tracked email — with the guardrails that keep you in the primary inbox.`
- Three pillars (each: mono index + Aspekta 24px title + 18px `--text-2-dark` body + lime arrow-square, separated by hairlines):
  - `01 CAPTURE` — `Read any job post.` — `Vision AI pulls the company, role, location, and recruiter address from a screenshot, with a confidence score on every field. Low confidence is flagged, never guessed.`
  - `02 COMPOSE` — `Written against your resume.` — `Match analysis scores the role 0–100 against your skills and surfaces the gaps. The draft stays under 180 words, in your tone. Nothing sends without your approval.`
  - `03 DISPATCH` — `Sent from your Gmail.` — `OAuth sending with your resume attached, addresses MX-checked, timing jittered, volume capped. Follow-ups fire on day 3 and day 7 and stop the moment a reply lands.`

**BAND 03 — COMPANY (`#company`, ink):** mono `02 / 03`. Headline (Aspekta 58px, white): `Built for the search, not the spray.` Sub (19px `--text-2-dark`, max-w 640px): `Mass senders get you filtered. GetHired is deliberately capped and personal — every email earns its place in someone's inbox. Your Gmail, your data, deletable in full at any time.` CTA: ghost button `LEARN THE GUARDRAILS →`.

**BAND 04 — HOW IT WORKS (`#how`, flip to BONE-WHITE):** mono section label `HOW IT WORKS` with 6px lime dot. Four editorial cards, `#fff` on `#f7f7f5`, radius 20px, 40px padding, `#c9cbbe` hairline, each: mono tag (`STEP 01`…`STEP 04`) + Aspekta 36px `#222f30` title + 18px `#4d5757` body + mono `NEXT →` cue. Cards can be a stacked list (image-left/text-right like the reference) or a 2×2 grid — match the reference's roomy two-column editorial card.
  - `STEP 01` — `Connect Gmail.` — `Two-minute OAuth. GetHired only ever sends as you — tokens are AES-256 encrypted and revocable.`
  - `STEP 02` — `Drop a screenshot.` — `Any LinkedIn or job-board post. Confirm the recruiter address the AI found, edit if needed.`
  - `STEP 03` — `Approve the draft.` — `Read the match score, tune the tone, edit a line. You are always the last check before send.`
  - `STEP 04` — `Watch the pipeline.` — `Opens, replies, follow-ups, ghosted flags — the whole search on one board.`

**BAND 05 — CLOSE (ink):** Headline (Aspekta 75px, white): `Your next role is one send away.` CTA: dark→**white** pill `START APPLYING` + lime arrow-square. Below, mono 13px `--text-2-dark`: `FREE WHILE IN BETA · GMAIL CONNECT TAKES TWO MINUTES.`

**FOOTER (pure `#000`):** left: `GetHired` wordmark + tagline (Aspekta 19px, `--text-2-dark`) `Personalized job outreach, instrumented.` Center/right: mono link columns `PLATFORM · COMPANY · HOW IT WORKS · LOG IN · REGISTER`. Bottom row hairline (`#4d5757`), mono 13px: `BUILT QUIETLY — GETHIRED © 2026` and social `LINKEDIN · X`.

## §7 — LAYOUT & RHYTHM RULES

Content well 1200px, centered, generous left-padding on dark bands (reference hugs text left). Section gaps 100–120px. Hairlines horizontal only (`#4d5757` on ink, `#c9cbbe` on bone), never vertical/double/dashed. Buttons: dark pill = `#222f30` fill / white mono, radius 10px, padding 10px 16px; ghost = transparent + 1px `#4d5757` + white text; lime arrow-square = `#cef79e` fill, `#222f30` arrow, ~56px, radius 14px. Nav pill frosted: `background: rgba(247,247,245,.7); backdrop-filter: blur(12px);` with a hairline. Accent lime appears ONLY as: arrow squares, 6px dots, active nav-pill fill, focus rings — never a large surface, never behind body text.

## §8 — VERIFY

1. `pnpm --filter @jobmail/client lint` → 0 errors. `pnpm --filter @jobmail/client build` → clean.
2. Run dev + Playwright (preinstalled): screenshot `/` at 1440px, 1024px, 390px. Confirm: floating pill nav overlaps the hero image; headline clamps without breaking words; the lime arrow squares render; the newsroom/how-it-works band is visibly bone-white while the rest is ink; footer is pure black; no shadows anywhere; scroll reveals fire once and stay.
3. Tab through the page: one lime focus ring style is visible on every link/button.
4. `grep -rn "847dff\|00b3dd\|Instrument\|shadow-\|rounded-\[" client/src/pages/Landing.tsx client/src/components/landing` → 0 hits.
5. Toggle `prefers-reduced-motion` (DevTools) → reload → content is fully visible, no transforms, Lenis off.
6. Lighthouse a11y on `/` ≥ 95; hero text contrast passes over the scrim.

## WORKING RULES

- Small commits, prefix `design(landing):`. Keep every route/link working. No bold, no italic, no second accent color, no shadows, black only in the footer, lime only at micro-scale. If a step seems to need server/API changes, stop and ask.
- Fidelity target: someone who knows integratedbio.com should immediately recognize the lineage — same nav treatment, same hero composition, same single-weight type, same lime arrow, same dark→bone→black band rhythm, same calm fade-rise motion — rendered with GetHired's words.
