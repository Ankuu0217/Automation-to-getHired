# BUILD SPEC — "JobMail Autopilot" (MERN + AI)

## 1. PRODUCT SUMMARY

**JobMail Autopilot** — a web app that turns LinkedIn job-post screenshots into sent, tracked, personalized HR outreach emails.

Core loop:

1. User uploads a screenshot of a LinkedIn job posting.
2. An AI pipeline extracts structured data: company, role, location, full JD text, HR/poster name, and any email addresses present (with confidence scores).
3. The app compares the extracted JD against the user's stored profile/resume and generates a short, highly personalized, professional outreach email (subject + body) addressed to the HR contact.
4. The user reviews/edits the generated email in a preview screen (human-in-the-loop by default; full auto-send is an opt-in setting).
5. On approval, the email is queued and sent through the user's own connected Gmail account, with the user's resume PDF auto-attached.
6. The application moves through a Kanban pipeline (Applied → HR Screen → Interview → Offer/Rejected) with open tracking, reply status, and automatic follow-up emails (day 3 and day 7) that stop on reply or bounce.
7. A dashboard shows funnel analytics: sent, opened, replied, interviews, response rate by template.

This is a real-world tool, not a demo. Prioritize reliability, deliverability, and data safety.

## 2. TECH STACK (use exactly this)

**Monorepo layout:** `/client`, `/server`, `/shared` (shared zod schemas & types).

**Frontend (`/client`)**

- React 18 + Vite + TypeScript (strict)
- Tailwind CSS + shadcn/ui components
- TanStack Query (server state), Zustand (UI state)
- React Router v6, react-hook-form + zod
- react-dropzone (screenshot upload), dnd-kit (Kanban)
- Recharts (analytics), lucide-react (icons), sonner (toasts)

**Backend (`/server`)**

- Node 20 + Express + TypeScript (strict)
- Mongoose (MongoDB), zod for request validation
- JWT auth in httpOnly secure cookies + bcrypt (cost 12)
- Multer (uploads, stored under `/server/uploads`, 10 MB limit, images only)
- Agenda (MongoDB-backed job queue — NO Redis; deliberate choice to keep infra MERN-only)
- Nodemailer (Gmail via OAuth2 for production; App Password supported for dev fallback)
- tesseract.js (OCR fallback only)
- pdf-parse (resume parsing)
- helmet, express-rate-limit, cors (whitelisted origin), pino (logging), express-mongo-sanitize
- node-cron is NOT needed (Agenda handles scheduling)
- `googleapis` for Gmail OAuth2 + optional reply detection

**AI Provider (pluggable via env)**

- Default: Google Gemini (multimodal, e.g. `gemini-1.5-flash`) via `@google/generative-ai` — reads the screenshot image DIRECTLY (vision), which is far more reliable than raw OCR on LinkedIn UI screenshots.
- Fallback chain: if no vision API key → tesseract.js OCR → regex + heuristics for emails/names.
- Provider abstraction: `/server/src/services/ai/provider.ts` exposes `extractJobFromImage(buffer)` and `generateOutreachEmail(input)` so OpenAI can be swapped in via env later.

**Env config:** validate all env vars at boot with zod (`/server/src/config/env.ts`), fail fast with a clear message.

## 3. DATA MODELS (Mongoose)

**User**: `{ email (unique), passwordHash, name, gmailAuth: { accessTokenEnc, refreshTokenEnc, expiry, connectedEmail }, settings: { autoSend: bool (default false), dailySendCap: number (default 30), followUpEnabled: bool (default true), tone: 'formal'|'confident'|'friendly' }, createdAt }`

**Profile** (1:1 with User): `{ fullName, headline, phone, location, yearsExp, skills: string[], links: { linkedin, github, portfolio }, summary, resumeFile: { path, originalName, parsedText }, preferredRoles: string[], noticePeriod, currentCTC?, expectedCTC? }`

**JobPost**: `{ userId, screenshotPath, rawExtractedText, extraction: { company, role, location, jdText, hrName, hrEmails: [{ email, confidence }], source: 'vision'|'ocr', confidence: number }, match: { score: 0-100, matchedSkills: string[], gaps: string[], angle: string }, status: 'extracted'|'email_drafted'|'awaiting_review'|'queued'|'sent'|'failed', dedupeHash (unique per user) }`

**Application** (created when an email is sent): `{ userId, jobPostId, hrEmail, hrName, company, role, stage: 'applied'|'hr_screen'|'interview'|'offer'|'rejected'|'ghosted', emails: [{ subject, bodyText, bodyHtml, kind: 'initial'|'followup_1'|'followup_2', scheduledAt, sentAt, openedAt, repliedAt, bouncedAt, messageId }], notes, createdAt }`

**EmailTemplate**: `{ userId, name, tone, subjectTemplate, bodyTemplate, isDefault, stats: { sent, opened, replied } }`

**EmailEvent** (tracking): `{ applicationId, kind: 'open'|'bounce'|'reply', meta, createdAt }`

Encrypt Gmail tokens at rest with AES-256-GCM (`/server/src/utils/crypto.ts`, key from env).

## 4. AI PIPELINE (most important — build carefully)

### Step A — Extraction (`extractJobFromImage`)

Send the screenshot to the vision model with a strict JSON-output prompt. Required output schema:

```json
{
  "company": "string|null",
  "role": "string|null",
  "location": "string|null",
  "jdText": "string (full cleaned JD text, no LinkedIn UI chrome)",
  "hrName": "string|null",
  "hrEmails": [{ "email": "string", "confidence": 0.0-1.0 }],
  "confidence": 0.0-1.0
}
```

Rules: ignore LinkedIn UI elements (nav, ads, "people also viewed"); only real job content. Validate emails with regex + MX DNS lookup before persisting. If multiple emails, rank by confidence (HR-name proximity > generic careers@ > info@). If zero emails, set status `extracted` and flag `needsEmail: true` so UI asks the user to paste one manually.

### Step B — Match analysis

Compare `jdText` vs `Profile.parsedText + skills`. Output: `{ score (0-100), matchedSkills[], gaps[], angle }` where `angle` = the single strongest positioning hook for this candidate+role (e.g. "led a payments migration matching their fintech stack requirement").

### Step C — Email generation (`generateOutreachEmail`)

Inputs: job extraction, match analysis, profile, tone, template (or default). Hard rules for the model:

- Max 180 words, plain professional English, zero fluff.
- Subject ≤ 7 words, specific (e.g. "Application: Backend Engineer — 5 yrs Node/fintech"), never "Job application" alone.
- First line must reference something SPECIFIC from the JD (the `angle`), never "I hope this email finds you well".
- Banned phrases: "I hope this finds you well", "I am writing to express my keen interest", " esteemed organization", "as per your requirements", generic flattery.
- Structure: hook (JD-specific) → 2-3 quantified proof points mapped to their must-haves → one soft CTA (15-min call / resume attached) → signature block from profile (name, phone, LinkedIn, portfolio).
- Output `{ subject, bodyText, bodyHtml }` (bodyHtml = simple semantic HTML, no images except signature text).
- If match score < 40, still generate but flag UI with "low match" warning.

## 5. EMAIL INFRASTRUCTURE (deliverability-first)

- All sends go through an **Agenda job queue** (`send-email` job), never inline in the request.
- Random jitter of 2–8 minutes between sends; enforce `dailySendCap` (default 30) and max 10/hour. Overflow reschedules to next day at 9–11 AM recipient-plausible time.
- Before every send: MX record check on recipient domain; skip + mark `failed` with reason on invalid domain.
- Multipart email: text + HTML; auto-attach the profile resume PDF renamed to `FirstName_LastName_Resume.pdf`.
- **Open tracking**: 1×1 transparent pixel `<img src="API_URL/api/t/o/:applicationId/:emailIndex.png">` — record `EmailEvent open`, set `openedAt`.
- **Follow-ups**: if `followUpEnabled` and no reply/bounce — schedule follow-up #1 at day 3, #2 at day 7, each a short polite nudge (≤ 60 words) in the same thread (use `References`/`In-Reply-To` headers with stored `messageId`). Stop sequence on: reply detected (manual mark or Gmail API poll), bounce, or stage change to `rejected`/`offer`.
- **Reply detection**: Phase 1 = manual "Mark as replied" button. Phase 2 (stub the service + interface now): poll Gmail API `history.list` for inbound messages from `hrEmail`.
- **Bounce handling**: webhook-less — parse Nodemailer response + (phase 2 stub) Gmail bounce scan. On bounce: mark email `bouncedAt`, cancel pending follow-ups.
- Dedupe: `dedupeHash = sha256(userId + hrEmail + company + role)` — block double-applying with a friendly UI warning showing the existing application.

## 6. BACKEND API (REST, `/api/v1`, zod-validated)

| Method              | Route                                                             | Purpose                                                                           |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| POST                | `/auth/register`, `/auth/login`, `/auth/logout`, GET `/auth/me`   | JWT cookie auth                                                                   |
| GET/PUT             | `/profile` + POST `/profile/resume`                               | Profile CRUD; resume upload triggers pdf-parse prefill of skills/summary          |
| GET/POST            | `/gmail/connect`, `/gmail/callback`, DELETE `/gmail/disconnect`   | OAuth2 flow                                                                       |
| POST                | `/jobs/upload`                                                    | Screenshot upload → async extraction (return jobPostId, poll status)              |
| GET                 | `/jobs/:id`                                                       | Extraction result + match score                                                   |
| POST                | `/jobs/:id/generate-email`                                        | Runs match + generation → draft                                                   |
| PUT                 | `/jobs/:id/draft`                                                 | Edit subject/body before send                                                     |
| POST                | `/jobs/:id/send`                                                  | Approve → enqueue (respects autoSend setting)                                     |
| GET/PATCH           | `/applications`, `/applications/:id` (stage, notes, mark-replied) | Kanban data                                                                       |
| GET/POST/PUT/DELETE | `/templates`                                                      | Template CRUD + per-template stats                                                |
| GET                 | `/analytics/funnel`                                               | sent/opened/replied/interview counts, rates, per-template breakdown, 30-day trend |
| GET                 | `/t/o/:applicationId/:idx.png`                                    | Tracking pixel (no auth, cache-bust headers)                                      |

Standard error format: `{ error: { code, message, details? } }`. Rate-limit auth + upload + generate endpoints.

## 7. FRONTEND (premium feel — this matters)

**Design language:** dark theme by default (`zinc-950` base), indigo→violet gradient accents, Inter font, glassmorphism cards, subtle framer-motion micro-animations, generous whitespace, skeleton loaders, thoughtful empty states, `sonner` toasts. It should look like a $50/mo SaaS, not a college project.

**Pages:**

1. **Landing** — hero ("Screenshot. Send. Get hired."), 3-step visual flow, feature grid, CTA → signup.
2. **Auth** — login/register, clean split-screen.
3. **Onboarding wizard** — upload resume (AI prefills profile → editable), connect Gmail (OAuth button + app-password fallback instructions), set tone & daily cap.
4. **Dashboard** — stat cards (Sent / Opened / Replied / Interviews + response-rate %), 30-day activity chart, "New Application" primary CTA, recent applications list.
5. **New Application flow (core screen)** — 3-step stepper:
   - **Upload**: drag-drop screenshot, live preview.
   - **Review extraction**: editable fields (company, role, HR name, HR email with confidence badge, JD text collapsed), match-score ring, low-confidence warnings, "email not found — paste manually" state.
   - **Email preview**: generated subject + body in a Gmail-style preview, inline edit, tone switcher (regenerates), resume-attachment chip, "Send now" / "Schedule for tomorrow 9 AM" buttons.
6. **Pipeline (Kanban)** — drag-drop columns Applied → HR Screen → Interview → Offer (+ Rejected), card shows company/role/HR/days-since-sent, follow-up countdown badges, opened/replied icons.
7. **Application detail drawer** — full email thread, events timeline (sent → opened → replied), manual "Mark replied", add notes.
8. **Templates** — CRUD + stats per template (A/B insight: response rate by template).
9. **Analytics** — funnel chart, opens/replies trend, best-performing tone/template.
10. **Settings** — Gmail connection status, daily cap slider, auto-send toggle (with clear warning copy), follow-up toggle, signature editor, danger zone (delete account + all data).

## 8. SECURITY & COMPLIANCE

- bcrypt(12), JWT in httpOnly SameSite=strict cookies, refresh rotation.
- AES-256-GCM encryption for Gmail tokens; key from env only.
- helmet, CORS whitelist, mongo-sanitize, rate limits (auth: 10/15min, upload: 20/hr, generate: 30/hr).
- File uploads: MIME sniff (not just extension), images only, 10 MB cap, stored outside web root, served via authenticated route.
- Never log email bodies or tokens. Pino redact paths.
- "Delete my data" wipes user, profile, jobs, applications, uploads folder, and revokes Gmail token.
- Add a clear in-app disclaimer: user is responsible for complying with anti-spam norms; app enforces caps + one-click manual review.

## 9. EDGE CASES (must handle, with tests)

1. Screenshot with **no email** → UI asks user to paste HR email manually; do not block the flow.
2. **Multiple emails** → show ranked list with confidence; user picks.
3. Blurry/low-quality screenshot → confidence < 0.5 → show raw extracted text and let user correct fields.
4. **Duplicate** application (same hrEmail+company+role) → warning + link to existing.
5. Daily cap reached → queue to next day, show "scheduled for tomorrow" state.
6. Gmail disconnected mid-queue → pause queue, banner in UI, resume on reconnect.
7. Bounce → cancel follow-ups, mark stage `ghosted` after 14 days of no reply.
8. Vision API down/quota → automatic fallback to tesseract OCR + regex extraction, badge the job as "OCR mode".
9. Resume missing at send time → block send with inline fix CTA.
10. User edits HR email after generation → revalidate MX before queueing.

## 10. TESTING & QUALITY

- Vitest unit tests: email regex/MX validator, dedupe hash, extraction JSON parser (with fixture screenshots + mocked model responses), follow-up scheduler logic, daily-cap logic.
- Supertest: auth flow, upload → extract → generate → send happy path (mocked AI + mocked Nodemailer transport).
- Seed script (`pnpm seed`) creating a demo user with 6 sample applications across all stages.
- `docker-compose.yml` for MongoDB only.
- README: setup steps, env table, Gmail OAuth setup guide, architecture diagram (ASCII), scripts.
- Scripts: `pnpm dev` (concurrently client+server), `pnpm build`, `pnpm test`, `pnpm lint`.

## 11. BUILD ORDER (deliver in these milestones, working software after each)

- **M1** — Repo scaffold, auth, profile + resume upload/parse, settings.
- **M2** — Screenshot upload + AI extraction (vision + OCR fallback) + review UI.
- **M3** — Match analysis + email generation + preview/edit + Gmail connect + queue send.
- **M4** — Pipeline Kanban + tracking pixel + manual reply marking.
- **M5** — Follow-up automation, bounce handling, analytics, templates.
- **M6** — Landing page, polish, empty states, tests, README, docker-compose.

After each milestone, state what was built and how to run/verify it. Do not skip ahead.

## 12. ACCEPTANCE CRITERIA (definition of done)

- [ ] Register → onboarding (resume prefill works) → connect Gmail (dev app-password mode OK) → upload a real LinkedIn screenshot → extraction shows correct company/role/email → generate email → email is personalized to the JD (no banned phrases) → edit → send → email received with resume attached → pixel registers open → Kanban card exists → follow-up scheduled and visible → funnel analytics update.
- [ ] All edge cases in §9 handled with UI states, not console errors.
- [ ] `pnpm dev` boots the whole app; `pnpm test` passes; README lets a stranger run it in < 10 minutes.

## 13. OUT OF SCOPE (design for, but do not build)

Chrome extension for one-click capture; Hunter.io/Clearbit email-guessing fallback when no email in post; multi-language outreach; team/agency mode; mobile app. Keep module boundaries clean so these slot in later.
