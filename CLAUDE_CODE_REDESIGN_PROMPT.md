# Claude Code Prompt — GetHired UI Redesign

> Copy everything below the line into Claude Code, run from the repo root
> (`Automations for getHired/`). Requires the REFERO MCP server connected.

---

## ROLE

You are a senior product designer + frontend engineer doing a **visual redesign pass** on an existing, working React app. You will use the **REFERO MCP server** for design references. You will NOT change any backend logic, API contracts, data fetching, routing, or business logic — this is a design-system refinement + UI polish + bug-fix pass only.

## PROJECT CONTEXT (already analyzed — trust this, verify quickly, don't re-explore for long)

pnpm monorepo, Node ≥20, TypeScript:

- `client/` — React 18 + Vite 5 + Tailwind 3.4 + shadcn-style primitives (cva) + TanStack Query 5 + zustand + react-router 6 + framer-motion + recharts + dnd-kit + sonner. Dev port 5173, proxies `/api` → `localhost:4000`.
- `server/` — Express + Mongoose + Agenda queue + Gemini AI + Gmail OAuth. **Do not touch.**
- `shared/` — zod schemas. **Do not touch.**

Product: "GetHired" (JobMail Autopilot) — turns LinkedIn job-post screenshots into AI-drafted, tracked HR outreach emails sent from the user's Gmail. Pages (in `client/src/pages/`): `Landing`, `Login`, `Register`, `Onboarding` (3-step wizard), `Dashboard`, `NewApplication` (upload → review → send, the core 1400-line flow), `Pipeline` (dnd-kit Kanban), `Dispatches` (table), `Templates`, `Analytics`, `Settings`. Layout: fixed top Nav (no sidebar) in `components/Nav.tsx` + `AppLayout.tsx`, max-w-[1200px] content well.

Current theme: dark-only "Midnight Gallery" — `#0f1011` obsidian bg, `#2e2e2e` graphite cards, hairline borders `rgba(255,255,255,0.06)`, Instrument Serif display headings (often with an italic word), Inter body, Roboto Mono micro-labels, accents `--iris #847dff` / `--cyan #00b3dd`, status `--ok #7fb069` / `--warn #d9a441` / `--danger #c4574e`. Tokens live in `client/src/index.css` (CSS vars + shadcn HSL vars + legacy "paper/ink" aliases) and `client/tailwind.config.ts`.

**The identity is good — keep it.** Dark, editorial, serif-display, hairline-driven. The problem is execution: three overlapping token systems, copy-pasted overrides, broken utility classes, hardcoded colors, no mobile nav, and inconsistent focus/hover states. Your job: keep the soul, rebuild the discipline.

## STEP 0 — REFERO RESEARCH (do this first)

Use the REFERO MCP tools before writing any code:

1. `refero_get_style` with these style UUIDs (pre-vetted for this redesign):
   - `11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6` — **Linear Changelog** ("midnight command center behind frosted glass") → **primary foundation**: surface layering (#08090a canvas → #141516 surface → #1c1c1f elevated), depth via borders not shadows, Inter weight-500 headings, pill interactive elements, compact density.
   - `50c47480-9451-420b-a372-eb42eda75e56` — **Sequel** (dark editorial, serif display, lozenge buttons) → borrow: how a serif display font coexists with a disciplined sans UI, pill CTAs, gray text hierarchy (#ffffff → #c0c0c0 → #999999).
   - `3a63b3fa-dc79-4dc3-935e-3f8f4ab447a7` — **Krea** (midnight terminal) → borrow: strict monochrome restraint, white-on-black primary buttons (which this app already uses), subtle section gradients.
2. `refero_search_screens` (platform `web`) for the app surfaces, and view the best 2–3 with `refero_get_screen_image` before redesigning each one:
   - "kanban board dark mode" → before touching Pipeline
   - "email compose preview dark" → before touching ProofSheet/NewApplication
   - "analytics dashboard funnel dark" → before touching Analytics/Dashboard
   - "settings page sections dark" → before touching Settings
   - "onboarding wizard steps" → before touching Onboarding
3. Synthesize ONE direction (do not copy any single reference wholesale): **Linear's surface/border/density discipline + this app's existing Instrument Serif editorial voice + Sequel's text-hierarchy restraint.** Chromatic accents (iris/cyan) survive but are demoted to: focus rings, links, active states, data-viz, and one primary metric per screen — never large surfaces.

## STEP 1 — TOKEN CONSOLIDATION (`index.css` + `tailwind.config.ts`)

1. Collapse the three coexisting systems (Midnight Gallery hex vars, shadcn HSL vars, legacy `--paper/--ink/--press/--gray-*` aliases) into ONE set of semantic tokens. Delete every legacy alias and every utility no component uses (`.mono-data`, `.btn-primary`, `.btn-ghost`, `.chip-ghost`, `.reveal-atmospheric` — verify usage first with grep).
2. Adopt Linear-style surface ladder while keeping current hues: `--bg` (#0d0e0f-ish), `--surface` (cards), `--surface-2` (hover/elevated), `--border` (white/6%), `--border-strong` (white/12%); text: `--text-1` (#f5f5f7), `--text-2` (~#9f9fa0), `--text-3` (~#6a6b6b). Keep `--iris`, `--cyan`, `--ok`, `--warn`, `--danger` exactly as-is (they're good), and align the shadcn `--accent` HSL to exactly `#847dff`.
3. Radius scale: keep 8/16/30/pill but make everyone use the named tokens (`rounded-func|card|tile|pill`) — replace every arbitrary `rounded-[8px]`/`[16px]`/`[30px]`/`[9999px]` literal across the codebase.
4. ONE focus-ring standard everywhere (recommend: `ring-2 ring-[--iris]/40 ring-offset-2 ring-offset-[--bg]` or the cyan equivalent — pick one, apply to Button, Input, Select, Textarea, Switch, nav links, Kanban cards, table rows).

## STEP 2 — PRIMITIVE FIXES (`components/ui/`)

1. **`button.tsx` has broken hover states**: `hover:opacity-92` and `hover:bg-pure/8` are invalid Tailwind 3 classes (need `opacity-[0.92]` / `bg-pure/[0.08]`) — hovers currently do nothing. Fix, and restyle per the Linear reference: white primary (keep), bordered secondary on `--surface-2`, ghost, destructive; add pressed states; add inset-highlight shadow from the Linear style (`rgba(255,255,255,0.04) 0px 1px 0px 0px inset`-style) instead of drop shadows.
2. **`input.tsx`**: the app overrides Input's own default styling with the same long class string in ~15 places (`bg-obsidian border-pure/[0.06] … focus-visible:ring-cyan/30`). Make that the actual default inside `input.tsx` (and `textarea`, `select`), then delete every per-instance override. Two competing input looks must become one.
3. Sweep `badge`, `card`, `sheet`, `switch`, `skeleton`, `slider`, `separator`, `label` for the same treatment: tokens only, consistent radius, the single focus ring.
4. Replace every `window.confirm()` (delete account in Settings, delete template in Templates, Gmail disconnect) with a proper themed `AlertDialog`/confirm component you build on the sheet/dialog pattern.

## STEP 3 — DEAD CODE & BROKEN REFERENCES

1. Delete unused components referencing CSS classes that no longer exist: `Stamp.tsx` (`.stamp`), `Masthead.tsx` (`.rule-double`), `DraftingGuides.tsx` (`.guide-line`), and unused `pages/ComingSoon.tsx` — after grep-confirming zero imports.
2. `Onboarding.tsx` inline `style={{animation:'fadeInUp …'}}` references a keyframe that doesn't exist — replace with the Tailwind `fade-in-up` utility.
3. Replace hardcoded colors with tokens: `ActivityChart.tsx` (`#6a6b6b`, `#00b3dd`, rgba borders in Recharts props), the MatchDial SVG in `NewApplication.tsx` (`#2e2e2e`, `#00b3dd`), border-trace SVGs. Recharts can read CSS vars via `var(--…)` strings or a small `chartTheme.ts`.

## STEP 4 — SCREEN-BY-SCREEN POLISH (use your REFERO screen references)

Priority order: **Nav/AppLayout → Dashboard → NewApplication → Pipeline → Landing → Analytics → Templates → Settings → Onboarding → Auth pages → Dispatches.**

- **Nav**: add a mobile menu — app links are `hidden md:flex` with no hamburger, so Templates/Analytics/Settings are unreachable on phones. Add `/dispatches` to the nav (currently reachable only via a Dashboard button). Unify terminology: pick "Pipeline" over "Wire Board" (nav label and page kicker currently disagree), keep "Dispatches" naming consistent everywhere.
- **Ledger.tsx**: fixed `grid-cols-[1fr_1.5fr_1.5fr_120px_80px_90px]` overflows small screens — add responsive columns or a scroll container; fix nested-interactive a11y (rows are `<button>` containing buttons — use a div row with a proper row action).
- **Dashboard**: stat strip doesn't wrap on narrow screens; tighten card rhythm to the Linear reference (16px card padding, 24px section gaps, consistent hairlines).
- **NewApplication**: keep the border-trace signature animation; give MatchDial `role="meter"` + aria label; add `aria-live` to ProcessingSequence; make failure panels (`MX_INVALID_DOMAIN`, `RESUME_MISSING`, `GMAIL_NOT_CONNECTED`, `SEND_FAILED`) visually consistent with the token system.
- **Pipeline**: card + column styling per your Kanban references; visible keyboard-focus on draggable cards; StatusLabel currently maps 5 of 12 states to the same gray dot — differentiate.
- **Landing**: keep sky-hero + chrome-frame identity, tone framer-motion durations down from 2.5s to ≤0.8s; `AiPromptInput` placeholder says "Paste a LinkedIn job URL" but the product accepts screenshots — fix the copy; remove or genericize the fabricated "Response rate 18%" stat.
- **Empty states**: the serif "No dispatches yet. *Send* the first." pattern is duplicated in ~5 files — extract one `EmptyState` component.
- Respect `prefers-reduced-motion` globally (currently only one animation does).

## STEP 5 — VERIFY (must pass before you're done)

1. `pnpm --filter @jobmail/client lint` (tsc --noEmit) — zero errors.
2. `pnpm --filter @jobmail/client test` — existing vitest suites pass (`button.test.tsx`, `pipelineUtils.test.ts`).
3. `pnpm --filter @jobmail/client build` — clean build.
4. `grep -rn "rounded-\[8px\]\|rounded-\[16px\]\|opacity-92\|bg-pure/8\|window.confirm" client/src` → zero hits.
5. Run the dev server, and screenshot-review every route at 375px and 1280px widths (use Playwright if available: it's preinstalled) — check nothing overflows and the nav works on mobile.
6. Do NOT modify anything under `server/`, `shared/`, or `client/src/lib/api.ts` query logic. If a design change seems to need an API change, stop and ask.

## WORKING RULES

- Small commits per step, message prefix `design:`.
- Keep every existing feature, route, handler, and react-query key exactly as-is.
- When in doubt between "flashy" and "quiet", choose quiet — the references are Linear/Sequel, not a crypto landing page.
- Anything you delete, grep first to prove it's unused.
