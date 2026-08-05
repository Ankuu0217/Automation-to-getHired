# Claude Code Prompt — GetHired Feature Build (9 features, phased)

> Paste into Claude Code from the repo root (`Automations for getHired/`).
> Build **one phase at a time**, in order — each phase ends with lint + test +
> build + a manual check before moving on. Every change is **additive**: do not
> break existing routes, react-query keys, or the send/track/follow-up pipeline.
> Match the current design system (bioluminescent-lab tokens in
> `client/src/index.css` + `docs/design/`). Touch **no secrets**; keep all new
> API endpoints authenticated and ownership-scoped exactly like the existing ones.

---

## ARCHITECTURE YOU'RE BUILDING ON (verify, don't re-derive)

- **Monorepo:** `client/` (React 18 + Vite + Tailwind + TanStack Query + zustand + react-router + framer-motion + recharts + dnd-kit), `server/` (Express + Mongoose + Agenda queue + Gemini + Gmail OAuth), `shared/` (zod schemas). Client calls server via `client/src/lib/api.ts` (typed `api<T>()`, cookie auth, `/api/v1` base). Shared zod types are imported by both sides — **add new types there, never duplicate**.
- **Models** (`server/src/models`): `User` (settings: `autoSend`, `followUpEnabled`, `dailySendCap`; `gmailAuth`; `lastSendError`), `Profile` (1:1 — `fullName, headline, phone, location, yearsExp, skills[], links{}, summary, signature, resumeFile{path,originalName,parsedText,uploadedAt}, preferredRoles, noticePeriod, currentCTC, expectedCTC`), `JobPost` (`extraction{company,role,location,jdText,hrName,hrEmails[{email,confidence}],confidence}, draft, match{score,matchedSkills,gaps,angle}`, `status`, `failureCode`, `dedupeHash`, unique `(userId,dedupeHash)`), `Application` (`jobPostId` unique, `stage`, `emails[]` thread subdocs with `sentAt/openedAt/cancelledAt/kind`, `notes`, `events[]`), `EmailTemplate` (`stats{sent,opened,replied}`, `isDefault`), `EmailEvent` (`kind:'open'`, `applicationId`, `emailIdx`, `meta{ua}`).
- **Routes** (`/api/v1`): `auth`, `profile` (`GET/PUT /`, `POST /resume`), `jobs` (`POST /upload`, `GET /`, `GET /:id`, `GET /:id/screenshot`, `PUT /:id/extraction`, `POST /:id/generate-email`, `PUT /:id/draft`, `POST /:id/send`), `gmail`, `applications` (`GET /`, `GET/PATCH /:id`, `POST /:id/mark-replied`), `templates` (CRUD), `analytics` (`GET /funnel`); plus `/api/t/o/:applicationId/:idx.png` (open pixel).
- **Queue** (`server/src/services/queue.ts`): Agenda jobs `send-email`, `send-followup`, `mark-ghosted`; `poll-replies` is a defined-but-unscheduled stub. Add new jobs with the same `agenda.define(...)` + schedule pattern. `QUEUE_INLINE=true` runs jobs synchronously (tests).
- **Pages** (`client/src/pages`): `Landing, Login, Register, Onboarding, Dashboard, NewApplication, Pipeline, Dispatches, Templates, Analytics, Settings`. Nav in `components/Nav.tsx` + `AppLayout.tsx`.

**Global rules for every phase:** new zod schema in `shared/src/*`, exported from `shared/src/index.ts` → new client fn in `lib/api.ts` → new server route mounted in `app.ts` → UI. Keep `api<T>()` error shape. Reuse the existing `validate()` middleware + `requireAuth`. Write/extend a vitest test in `server/test/` for every new endpoint (there are existing flow tests to mirror). Commit per phase, prefix `feat:`.

---

## PHASE 1 — Resume & Profile management in Settings  *(low risk; backend already supports re-upload)*

**Why:** Resume can only be set during Onboarding today. The server route `POST /profile/resume` already replaces the old file (deletes prior, re-parses) — this is a **frontend gap** plus one small download route.

- **Server:** add `GET /profile/resume/download` — auth + ownership, streams the stored PDF from `profile.resumeFile.path` with `Content-Disposition: attachment; filename="<originalName>"`; 404 if none. (Reuse the authenticated-file-streaming pattern from `jobs GET /:id/screenshot`.)
- **Shared:** none needed (resume DTO exists); add a `resumeFile` presence flag if convenient.
- **Client `lib/api.ts`:** confirm `uploadResume`/parse fn exists (Onboarding uses it) — reuse it; add `downloadResumeUrl()` helper returning the endpoint.
- **UI — `Settings.tsx`:** add a new **"Profile"** section (and a `SubNav` entry) ABOVE Gmail, with two cards:
  1. **Resume** — show current file: `originalName` + "Uploaded <relative date>", a **Download** link, and a **Replace résumé** dropzone (react-dropzone, PDF only, 10 MB — mirror Onboarding's dropzone + prefill toast). On success invalidate `['profile']`, toast "Résumé updated."
  2. **Profile details** — an editable form (react-hook-form + zod) for `fullName, headline, skills[] (chip editor — reuse Onboarding's SkillsEditor), links{linkedin,github,portfolio}, summary, preferredRoles, noticePeriod, currentCTC, expectedCTC`, saved via existing `PUT /profile` (`updateProfile`).
- **Design:** match current tokens; replace the section's `window.confirm` nowhere (none here). Use the lime arrow-square as the save affordance to stay on-system.
- **Verify:** upload a new PDF from Settings → profile reflects new resume → download returns it → a subsequent send attaches the new resume. `pnpm --filter @jobmail/client build` clean.

## PHASE 2 — Paste a job description (URL / text), not just screenshots  *(the landing promises this)*

**Why:** Capture today is screenshot-only; the landing hero implies paste. Add a text path through the SAME extraction → JobPost → review flow.

- **Server:** `POST /jobs/import` `{ rawText: string (min ~40 chars), sourceUrl?: string }`. Run extraction from text (not vision): add a `extractFromText()` in `services/ai/gemini.ts` reusing the existing strict-JSON extraction schema (company/role/location/hrName/hrEmails[]/confidence) but prompted on pasted text; **OCR/heuristic fallback** = the existing regex heuristics on the raw text when no `GEMINI_API_KEY`. Build the `JobPost` exactly like `/jobs/upload` does (same `dedupeHash` from company+role, same `status` progression, store `sourceUrl` + `rawText` into `extraction.jdText`). **Do NOT server-fetch arbitrary URLs** (SSRF risk) — treat `sourceUrl` as a stored reference link only; the user pastes the text. Note this limitation in a comment.
- **Shared:** `importJobSchema` in `shared/src/jobs.ts`; export it.
- **Client:** `importJob()` in `lib/api.ts`.
- **UI — `NewApplication.tsx` upload step:** add a segmented control **"Screenshot | Paste text"**. The paste panel = a textarea (JD) + optional URL field → calls `importJob` → drops the user into the existing Review step (extraction editing, HR-email ranking, match dial) unchanged. Update the Landing/AiPromptInput copy so it matches (paste OR screenshot).
- **Verify:** paste a real JD → review shows extracted company/role/emails → generate + send works identically to the screenshot path. Add `server/test/importJob.test.ts`.

## PHASE 3 — Interview tracking + reminders

- **Server:** `Application` model gains `interviewAt?: Date`, `interviewNote?: string`. Extend `PATCH /applications/:id` to accept them (validated). New Agenda job `interview-reminder`: when `interviewAt` is set, schedule a reminder at `interviewAt − 24h` (and skip if already past) that **emails the user's own address** via `services/mailer` ("Interview with <company> tomorrow") and creates a Notification (Phase 7). On `interviewAt` change/clear, cancel + reschedule (mirror `stopFollowUpSequence`/`scheduleSendEmail` cancel logic). Guard: only when stage is `interview`.
- **Shared:** add `interviewAt/interviewNote` to the application detail + summary DTOs and the patch schema in `shared/src/applications.ts`.
- **UI:** in `ApplicationDrawer`, when stage Select → `interview`, reveal a date-time input + note. `Pipeline` interview cards show a date badge. `Dashboard` gains an **"Upcoming interviews"** module (next 5, sorted). Empty state via the shared `EmptyState`.
- **Verify:** move a card to Interview, set a date → Dashboard lists it → (with `QUEUE_INLINE`) reminder job schedules without error. Test the PATCH accepts/validates `interviewAt`.

## PHASE 4 — Recruiter contacts (mini-CRM) + double-outreach guard

**Why:** dedupe blocks the same *job* twice, but nothing stops emailing the same *recruiter* across two different jobs. Real deliverability + etiquette win.

- **Server:** `GET /contacts` — aggregation (no new model): group the user's `JobPost.extraction.hrEmails` + linked `Application`s by recruiter email → `{ email, name?, companies[], roles[], outreachCount, lastContactedAt, anyReplied }`. Sort by `lastContactedAt` desc. Ownership-scoped. Optionally `GET /contacts/:email` for the full outreach list to that person.
- **Double-outreach guard:** in the generate/send path, compute whether this `hrEmail` was contacted in the last N days (e.g. 14) across other applications and return a **non-blocking** `recentContact` flag on the job/review DTO so the UI can warn ("You emailed this recruiter 4 days ago"). Never hard-block — just surface it.
- **Shared:** `contactSchema`, `contactsResponse`.
- **Client + UI:** `getContacts()`; new **Contacts** page (add to Nav + route) — a mono-labeled table (recruiter, company/roles, #outreach, last contacted, replied dot). Row expands to the outreach history. Show the `recentContact` warning banner in `NewApplication` review + `ProofSheet` before send.
- **Verify:** two applications to the same recruiter email → Contacts shows one row with count 2 → review of the second shows the recent-contact warning. Test the aggregation endpoint.

## PHASE 5 — Analytics upgrades

- **Server:** extend `services/analytics` + add endpoints under `/analytics`: `GET /analytics/timing` (open-rate by hour-of-day → best send window), `GET /analytics/by-template` (sent/opened/replied + reply-rate per template), `GET /analytics/by-tone` (reply-rate per draft tone), `GET /analytics/response-time` (distribution of `sentAt → repliedAt`). All derive from existing `Application.emails`, `EmailEvent`, `JobPost.draft.tone`, `templateId`. Keep them cheap (aggregate pipelines, ownership-scoped).
- **Shared:** schema additions in `shared/src/analytics.ts`.
- **UI — `Analytics.tsx`:** new panels using **recharts**. Before writing any chart, read the `dataviz` skill and use the design tokens (lime line/bars on ink, `#4d5757` gridlines, mono axis labels, ink-2 tooltip). Panels: "Best time to send" (hourly bar), "Reply rate by template" (bar), "Reply rate by tone" (bar), "Response time" (histogram). Every color via `var(--…)`.
- **Verify:** panels render with seeded data; zero hardcoded hex in the TSX. Test each endpoint returns the documented shape.

## PHASE 6 — Pipeline / Kanban upgrades  *(you already have a dnd-kit board — enhance it)*

**Note:** `Pipeline.tsx` already renders the Kanban (5 stages + Ghosted). Do **not** rebuild — extend.

- **Client-only** (the `GET /applications` list already returns everything): add a toolbar with **search** (company/role), **filter chips** (date range, has-reply, show/hide ghosted), per-column **count + oldest-age** header (mono `01 APPLIED · 4`), and **sort within column** (newest / oldest / most-stale). Persist the active view to `localStorage` (`gethired.pipeline.view`) so it survives reloads. Keep dnd-kit drag + optimistic stage moves intact. Add visible lime keyboard-focus on cards.
- **Optional server:** accept `?q=&stage=&hasReply=` query params on `GET /applications` for server-side filtering if the list grows — but client-side is fine at current scale; if you add params keep them optional and backward-compatible.
- **Verify:** search narrows cards live; filters + counts update; drag still persists stage; refresh keeps the view. Existing `pipelineUtils.test.ts` still passes.

## PHASE 7 — Open / reply notifications

- **Server:** new `Notification` model `{ userId, kind:'open'|'reply'|'interview'|'bounce', applicationId, title, body, read:boolean, createdAt }`. Emit on: first open (in `routes/tracking.ts`, where `openedAt` is first set — create one Notification), manual `mark-replied`, bounce recording (`services/jobs/sendEmail.ts`), and interview reminders (Phase 3). Routes: `GET /notifications` (recent + unread count), `PATCH /notifications/:id/read`, `POST /notifications/read-all`. Ownership-scoped; cap history (e.g. last 100). Note in a comment that auto **reply** detection is still the phase-2 stub, so reply notifications currently come from manual mark-replied.
- **Shared:** `notificationSchema`, list/unread-count response.
- **Client + UI:** `getNotifications()/markRead()/markAllRead()`; a **bell icon** in `Nav.tsx` with an unread badge + a dropdown panel (recent items, click → open the application drawer, mark-all-read). Poll with react-query `refetchInterval` (e.g. 60s) — do not add websockets. Toast on new open/reply while the app is focused (optional).
- **Verify:** hitting the tracking pixel creates an open notification → bell badge increments → mark-all clears it. Test the notification endpoints + that the pixel still returns the 1×1 PNG unchanged.

## PHASE 8 — Bulk screenshot upload (batch)

**Why:** power users apply to many roles; one-at-a-time is slow. Orchestrate the EXISTING single-upload endpoint in a batch UI — minimal backend.

- **Client-only orchestration:** new **"Batch"** entry point (a mode in `NewApplication` or a `/apps/batch` route). Multi-file dropzone (accept N screenshots) → upload each via the existing `POST /jobs/upload` (concurrency-limit to ~3 to respect the upload rate-limiter) → show a grid of processing→extracted cards (poll each job's `GET /jobs/:id` like the single flow) → let the user review/fix each → **generate + queue/send all** with a summary (n sent, n need attention). Reuse the single-flow components (extraction editor, match dial, ProofSheet) per card.
- **Server:** none required. If the `uploadLimiter` is too tight for batches, note it — don't loosen security silently; instead surface "queued, sending over the next few minutes" and let the client pace uploads.
- **Verify:** drop 3 screenshots → all three reach the review grid → batch-generate produces 3 drafts → sending respects the daily cap + jitter. No changes to send guardrails.

## PHASE 9 — CSV export + weekly goal & streak

- **CSV export (client-side, safe):** from the already-loaded applications list, build a CSV (company, role, recruiter email, stage, sent date, opened, replied, follow-ups) and trigger a client download (`Blob` + object URL, revoke after). Add an **"Export CSV"** button to `Dispatches` and/or `Pipeline`. No new endpoint, no PII leaving via a server route.
- **Weekly goal & streak:** `User.settings` gains `weeklySendGoal?: number` (validated addition to the settings schema + the existing `PATCH /auth/settings`). `Dashboard` shows **"This week: n / goal"** progress + a **streak** (consecutive days with ≥1 send, computed client-side from application `sentAt`s). A control in Settings → Sending to set the goal.
- **Shared:** extend settings schema with `weeklySendGoal`.
- **Verify:** export downloads a well-formed CSV opening cleanly in a spreadsheet; setting a goal reflects on Dashboard; streak counts correctly across day boundaries. Test the settings schema accepts `weeklySendGoal`.

---

## FINAL VERIFICATION (after all phases)

1. `pnpm --filter @jobmail/server test` and `pnpm --filter @jobmail/client test` → all green (existing + new).
2. `pnpm -r build` → clean. `pnpm --filter @jobmail/client lint` → 0 errors.
3. Manual smoke: register → onboard → paste a JD → generate → send → open the pixel → see notification → move to Interview + set date → Dashboard shows it → Contacts lists the recruiter → Analytics panels render → export CSV → replace résumé in Settings.
4. Confirm you changed **no** existing route contract (only additive), the send/track/follow-up pipeline is untouched, and no secrets or `.env` values were committed.
5. Every new chart uses design tokens (no hex in TSX); every new surface uses the bioluminescent-lab tokens; new destructive actions use a themed confirm dialog (not `window.confirm`).

## WORKING RULES

- One phase per branch/commit series; don't start a phase until the previous one's verify passes. If a phase needs a schema/model change, do shared-schema → model → route → api → UI in that order.
- Additive only. If anything seems to require changing an existing endpoint's response shape or the auth/queue internals, **stop and ask** before proceeding.
- Keep the product's guardrails sacred: daily cap, hourly throttle, jitter, MX check, approval-before-send, dedupe. New features must never weaken them.
