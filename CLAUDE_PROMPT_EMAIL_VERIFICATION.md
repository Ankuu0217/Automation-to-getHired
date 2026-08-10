# Claude Code Prompt — Email verification at signup (sending-gated)

> Run from repo root `/Users/ankitsingh/Automations for getHired`.
> Monorepo: `server` (Express + Mongoose/MongoDB + TS), `client` (React 18 +
> Vite + react-hook-form + zod + react-query + zustand + sonner), `shared`
> (`@jobmail/shared` zod schemas, types, `ErrorCodes`). I've already read the
> auth stack — build against these real symbols, don't reinvent them.

You are a senior full-stack engineer who ships secure auth for a living. The
product **sends emails on the user's behalf**, so an unverified address is a
real deliverability/abuse risk. Add email verification without breaking the
existing session/refresh flow.

## Enforcement policy (decided — build exactly this)

**Sending-gated.** A new user can register, log in, complete onboarding, and
even connect Gmail. But **the app must not send any outreach email until the
account's email is verified.** Everywhere in the app show a "Verify your email
to start sending" banner with a Resend button. Login is NOT blocked;
onboarding is NOT blocked; only the send pipeline is gated.

---

## What the code already does (verified — reuse, don't duplicate)

- `server/src/routes/auth.ts` — `authRouter`. `POST /register` today:
  `User.findOne` dup-check → `bcrypt.hash` (cost 12) → `User.create` →
  `Profile.create` → `issueSession(res,user)` → `201 { user: toPublicUser }`.
  Also has `/login`, `/logout`, `/refresh` (rotation), `/me`, `/settings`,
  `DELETE /account`. Helpers: `issueSession`, `toPublicUser`.
- `server/src/models/User.ts` — Mongoose `IUser` / `User`. `{ timestamps }`.
  Fields: email (unique, lowercase), passwordHash, name, gmailAuth, settings,
  `refreshTokenHashes` (select:false), `lastSendError`.
- `server/src/services/tokenService.ts` — JWT cookies (`jm_access`/`jm_refresh`),
  and the **pattern to copy**: store only `sha256(token)` hashes at rest.
- `server/src/utils/crypto.ts` — exports `sha256`, `encrypt`, `decrypt`. Use
  `sha256` for the verification token hash. `crypto.randomBytes` for the token.
- `server/src/services/mailer.ts` — `sendMail()` sends **from the user's
  connected Gmail** (OAuth), dev fallback = app password
  (`env.GMAIL_USER`/`env.GMAIL_APP_PASSWORD`). **Do not touch `sendMail` — the
  user has no Gmail connected at signup.** You'll add a separate system sender.
- `server/src/middleware/` — `requireAuth`, `validate(schema)`, `authLimiter`,
  `AppError`, `errorBody`. `server/src/config/env.ts` — zod-validated `env`.
- Tests: `server/test/authFlow.test.ts` — vitest + supertest +
  `mongodb-memory-server`, cookie jar helpers. Mirror this style.
- Client: `client/src/pages/Register.tsx` (rhq+zod, on success
  `setUser(user)` → toast → `navigate('/onboarding')`),
  `client/src/stores/auth.ts` (`useAuthStore`), `client/src/lib/api.ts`
  (`register`, `ApiRequestError`), `client/src/components/AppLayout.tsx`.
- `PublicUser` type + `registerSchema`/`loginSchema`/`ErrorCodes` live in
  `shared`.

---

## 1) Data model — `server/src/models/User.ts`

Add:
- `emailVerified: boolean` — `{ type: Boolean, default: false, index: true }`.
- `emailVerification?: { tokenHash: string; expiresAt: Date; sentAt: Date }` —
  a subdocument with `select: false` (never leaves the DB by default). Add an
  index on `emailVerification.tokenHash` (sparse) for O(1) lookup on verify.
- Update `IUser` accordingly.

**Single-use + rotation:** issuing a new token overwrites `emailVerification`;
successful verify sets `emailVerified=true` and **unsets** `emailVerification`.

**Grandfather existing beta users** so this doesn't silently block their
sending: add `server/scripts/backfill-email-verified.ts` (a tiny script that
connects with the app's mongoose config and runs
`User.updateMany({ emailVerified: { $exists: false } }, { $set: { emailVerified: true } })`),
and note the command to run it in the PR description. New signups still default
to `false`.

## 2) shared (`@jobmail/shared`)

- Add `ErrorCodes.EMAIL_NOT_VERIFIED` (and a `FORBIDDEN`/403 mapping if not
  present).
- Add zod `verifyEmailSchema = z.object({ token: z.string().min(20) })`.
- Extend `PublicUser` with `emailVerified: boolean`. Update `toPublicUser` in
  `auth.ts` to return it. (This is what drives the client banner.)

## 3) System transactional mailer — extend `server/src/services/mailer.ts`

Add `sendSystemMail({ to, subject, text, html })` — a **system/no-reply**
sender independent of any user's Gmail. Transport priority:
1. Dedicated SMTP if configured (`env.SMTP_HOST/PORT/USER/PASS`) — the right
   prod path (Resend/Postmark/SES/etc. all speak SMTP).
2. Else the existing app-password account (`env.GMAIL_USER` +
   `env.GMAIL_APP_PASSWORD`) as the system sender.
3. Else **dev/test mode**: do not throw — `logger.info` the full verification
   URL and use nodemailer's `jsonTransport` so local dev and tests never send
   real mail or hang. Gate on `env.NODE_ENV`.

`from` = `env.MAIL_FROM` (e.g. `"GetHired" <no-reply@gethired.app>`), falling
back to the transport user. Never log the raw token in prod (dev only).

Add env keys to `config/env.ts` (all optional with the dev fallback above):
`APP_URL` (public web origin for links — reuse an existing CLIENT/APP url var
if one exists), `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

## 4) Verification service — `server/src/services/emailVerification.ts`

- `issueEmailVerification(user)`: `token = randomBytes(32).toString('hex')`;
  set `user.emailVerification = { tokenHash: sha256(token), expiresAt:
  now+24h, sentAt: now }`; `await user.save()`; build
  `${env.APP_URL}/verify-email?token=${token}`; call `sendSystemMail` with an
  on-brand template (see below). Return nothing (never return the raw token
  except into the email/link).
- `verifyEmailToken(token)`: `hash = sha256(token)`;
  `User.findOne({ 'emailVerification.tokenHash': hash })
   .select('+emailVerification')`. If none → invalid. If
  `expiresAt < now` → expired (distinct error so the UI can offer resend). Else
  `user.emailVerified = true; user.emailVerification = undefined; save()`.
  Idempotent: if a user is already verified and token is gone, treat a repeat
  click as success (don't hard-error the happy path).
- 60-second resend cooldown: reject re-issue if `sentAt` is < 60s ago
  (`ErrorCodes` 429-style) — cheap abuse guard on top of `authLimiter`.

**Email template:** single-column, plain-text + HTML, one CTA button to the
link, the 24h expiry line, and "If you didn't create a GetHired account, ignore
this email." Keep copy tight and on-brand (GetHired voice).

## 5) Endpoints — `server/src/routes/auth.ts`

- **`POST /register`** (keep everything else): after `Profile.create`, call
  `issueEmailVerification(user)` inside a `try/catch` — **a mail failure must
  NOT fail registration** (log it; the user still lands in-app and can Resend).
  Keep `issueSession` (policy = user is logged in). Response unchanged shape;
  `toPublicUser` now carries `emailVerified:false`.
- **`POST /verify-email`** — **public** (token is the proof; no `requireAuth`,
  so a link opened on another device still works). `validate(verifyEmailSchema)`
  → `verifyEmailToken` → `200 { user? }` on success, `AppError` 400 with a code
  distinguishing `invalid` vs `expired`. Rate-limit with `authLimiter`.
- **`POST /resend-verification`** — `requireAuth` + `authLimiter`. If already
  verified → `200 { ok:true }` no-op. Else `issueEmailVerification` (respecting
  the 60s cooldown). Never reveal anything about other accounts.

## 6) The gate — block sending until verified (THIS is the enforcement)

Find the exact places outreach mail is triggered and add a hard check
`user.emailVerified === true`, failing closed:
- The **API action** that enqueues/sends an application email (inspect
  `server/src/routes/applications.ts` and the send/enqueue path in
  `server/src/services/queue.ts` / `emailRules.ts`). At the request boundary,
  if not verified → `AppError(403, ErrorCodes.EMAIL_NOT_VERIFIED, 'Verify your
  email to start sending')` so the client can show a precise message.
- **Defense in depth** in the queue worker right before the outreach
  `sendMail(...)` call: if the owning user isn't verified, skip/fail the job
  with the same code and surface via `lastSendError` (reuse the existing
  banner mechanism) rather than sending.
- Do **not** gate: login, onboarding, Gmail connect, profile, analytics, or
  `sendSystemMail` (verification mail itself must always be allowed).

Search the codebase for every `sendMail(` call and confirm only **outreach**
sends are gated, not system mail. List what you found in the PR description.

## 7) Client

- **Route + page:** add `/verify-email` → `VerifyEmail.tsx`. Read `?token=`,
  `POST /verify-email` on mount, render three states: verifying / success
  (then `setUser` if returned, route to `/dashboard` or `/onboarding`) /
  invalid-or-expired (with a Resend button when logged in, else a "sign in to
  resend" link). Use `AuthLayout` for visual consistency.
- **Banner:** `VerifyEmailBanner.tsx` rendered in `AppLayout` whenever
  `useAuthStore` user has `emailVerified === false`: text "Verify your email to
  start sending." + **Resend** button → `POST /resend-verification` → sonner
  toast (`"Verification email sent — check your inbox."`), with a client-side
  60s cooldown on the button. Dismissible per-session but reappears on reload.
- **Register success:** keep `navigate('/onboarding')`, but the banner now
  greets them; optionally a one-line "We sent a link to <email>."
- **Send action:** when any send call returns `EMAIL_NOT_VERIFIED`, toast
  "Verify your email to start sending." and scroll/point to the banner — don't
  silently swallow it.
- **Types/api:** extend the auth store `User` and `lib/api.ts` with
  `emailVerified`, and add `verifyEmail`, `resendVerification` API fns.

## 8) Tests (`server/test/emailVerification.test.ts`, vitest + supertest + mongodb-memory-server)

Mirror `authFlow.test.ts` (in-memory Mongo, cookie jar). Because the raw token
only exists in the email, in test mode capture it: assert `sendSystemMail` used
`jsonTransport` and read the link from the captured message (spy/stub the
mailer, or expose the last system message in test env). Cover:
1. register → `me` shows `emailVerified:false` and `emailVerification` exists.
2. verify with the captured token → `emailVerified:true`, token unset; second
   use of the same token fails (single-use).
3. expired token (fast-forward `expiresAt`) → 400 `expired`.
4. resend respects the 60s cooldown.
5. **the gate:** attempting an outreach send while unverified → 403
   `EMAIL_NOT_VERIFIED`; after verifying, the same action passes the check.
6. `sendSystemMail` never uses a user's Gmail transport.

## Security requirements (non-negotiable)
- Token: ≥32 random bytes, only its `sha256` stored, 24h expiry, single-use,
  rotated on resend. Raw token only ever in the email link.
- No account-existence leak on public endpoints; resend is auth-gated.
- Reuse `authLimiter` + the 60s cooldown. Verification mail bypasses the send
  gate but not rate limits.
- Never log tokens/links outside dev. Don't weaken the existing refresh
  rotation or cookie flags.

## Deliverables & rules
- `pnpm -r lint` and `pnpm -r test` green (server + shared + client).
- Show a per-file diff summary before editing. New deps: none required beyond
  `nodemailer` (already present).
- Keep existing routes/response shapes backward-compatible (only additive
  fields). Don't change the sending behavior for already-verified users.
- In the PR description: list every `sendMail(` call site and whether it's
  gated, plus the backfill command to run once in each environment.
