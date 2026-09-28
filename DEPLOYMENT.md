# Going live — GetHired

**Frontend on Vercel, API on Render**, database on MongoDB Atlas, files on ImageKit.

```
browser ──► https://gethired.vercel.app            (Vercel: React app)
                 └─ /api/*  ──proxy──►  https://gethired-api.onrender.com   (Render: API)
```

The browser only ever talks to the Vercel domain: `vercel.json` rewrites `/api/*` to
Render. That keeps the `SameSite=Strict` auth cookies first-party. Calling the Render URL
directly from the frontend would break login (cross-site cookies are blocked, e.g. by Safari)
and need CORS. So **don't set `VITE_API_URL`** on Vercel.

## 0. ₹0 setup (up to 100 users)

Everything below on free tiers. The repo's `render.yaml` is already the free profile.

| Service | Free plan | What it gives you |
|---|---|---|
| Vercel Hobby | React app + `/api` proxy | non-commercial use only, 100 GB/month transfer |
| Render Free | API (0.1 CPU / 512 MB) | sleeps after 15 min idle → keep awake with a free ping (§5d) |
| MongoDB Atlas M0 | database | 512 MB ≈ 15–20k applications |
| ImageKit Free | résumés + screenshots | 3 GB storage, 20 GB/month bandwidth (screenshots auto-deleted after 14 days) |
| Gemini API free tier | AI reading + writing | ~15 requests/min, ~1,500/day for the whole app; Google may use the content (shown on `/privacy`) |
| Brevo Free | verification emails over HTTPS | 300 emails/day |
| Google OAuth (unverified) | users send from their own Gmail | **100 users total**, "unverified app" warning on consent |

How the free profile avoids the free-plan traps:
- **No SMTP anywhere.** Render Free blocks SMTP ports, so outreach goes through the
  **Gmail API over HTTPS** and verification mail through **Brevo's HTTPS API**.
- **OCR off** (`OCR_ENABLED=false`) — on 0.1 CPU it takes ~1 min per screenshot. Gemini
  reads screenshots; if it can't (quota), the user types the details into the form.
- **Light CPU/RAM settings**: `BCRYPT_COST=10`, 2 extractions / 3 uploads / 2 sends at once.
- Restarts are safe: stuck extractions re-run, the queue lives in MongoDB.

Limits you will hit: 100 Gmail-connecting users (needs a custom domain + Google
verification to lift), and Gemini's shared free quota (~500 applications/day).
Expect 20–50 comfortably active users.

## 1. Accounts you need

| What | Why | Cost (≈1000 users) |
|---|---|---|
| Domain name | OAuth verification needs a homepage + privacy policy on **your own domain** | ~₹800/yr |
| Render — **Standard** (1 CPU / 2 GB) | Hosts the API; stays awake so follow-ups fire on time | $25/mo |
| Vercel | Hosts the React app + proxies `/api` | Hobby free (non-commercial) · Pro $20/mo |
| MongoDB Atlas — **Flex** (5 GB) | Database + job queue | $8–30/mo |
| ImageKit | Private storage for resumes + screenshots | Free (3 GB) → Lite $9/mo |
| Google Cloud project | Gmail OAuth — users send from their own Gmail | Free |
| Gemini API **with billing on** (Tier 1) | Screenshot reading, match, email writing | ~$0.005–0.014 per application |
| Brevo (or Resend/SES) SMTP | Verification emails | Free up to 300/day |

Why not the free tiers for real users:
- **Render Free** sleeps after 15 min idle (follow-ups fire late). **Starter (512 MB)** is too
  small: the OCR fallback alone peaked at ~550 MB RAM in load tests.
- **Atlas M0** has 512 MB — roughly 15–20k applications (each ≈30 KB incl. job text and
  email bodies), i.e. a few weeks at 1000 active users.
- **Gemini free tier** limits are per *project* (shared by all your users, roughly
  15 requests/min) and Google may use free-tier prompts — here, users' résumés — to
  improve its models. Enable billing before real users arrive.

## 2. MongoDB Atlas
1. Create a **Flex** cluster (M0 is fine for testing) → Database Access → add a user.
2. Network Access → allow `0.0.0.0/0` (Render IPs are dynamic).
3. Copy the connection string, add the DB name: `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/jobmail?retryWrites=true&w=majority`
4. Move to a dedicated **M10** (~$57/mo, backups) once storage passes ~4 GB.

## 3. ImageKit (file storage)
1. Sign up at imagekit.io → Dashboard → **Developer options**.
2. Copy the **private key** → `IMAGEKIT_PRIVATE_KEY`, and the **URL endpoint**
   (`https://ik.imagekit.io/<your_id>`) → `IMAGEKIT_URL_ENDPOINT`.
3. Verify: `pnpm --filter @jobmail/server imagekit:check` uploads a private test file, reads
   it back through a signed URL and deletes it, printing a fix hint if anything fails.
4. Files are uploaded as **private** under `/gethired/{resumes,screenshots}/<userId>/`
   and are only reachable through signed URLs that expire (2 min for server fetches,
   1 h for screenshot previews). Replaced resumes and deleted accounts remove their files.
5. Files uploaded before you set these keys stay on local disk and keep working locally;
   new uploads go to ImageKit.

## 4. Google Cloud (Gmail OAuth) — **required for more than 100 users**
1. console.cloud.google.com → new project → enable **Gmail API**.
2. OAuth consent screen → External → app name, logo, support email, homepage
   `https://YOUR-DOMAIN/`, privacy policy `https://YOUR-DOMAIN/privacy` (the app ships this
   page — set `VITE_CONTACT_EMAIL` and review the text), authorized domain = your domain
   (verify it in Google Search Console). Scope: `.../auth/gmail.send` only.
3. Credentials → OAuth client ID → Web application.
   Authorized redirect URI: `https://YOUR-DOMAIN/api/v1/gmail/callback`
4. **Testing** mode: only listed test users (max 100) can connect and their tokens expire
   every 7 days. An unverified *published* app is also capped at **100 users**.
5. **Publish → Prepare for verification.** `gmail.send` is a *sensitive* scope: Google asks
   for a YouTube (unlisted) demo video showing the consent screen and a real send, plus a
   one-paragraph justification ("sends the outreach emails the user reviews, from their own
   account; the app cannot read the mailbox"). Review typically takes 3–5 business days.
   No paid security assessment (that's only for *restricted* scopes like gmail.readonly).

## 5. Deploy — Render (API) first, then Vercel (frontend)

### 5a. Render — API
1. Push this repo to GitHub (it includes `render.yaml` and `vercel.json`).
2. Render → New → **Blueprint** → select the repo. It creates the web service
   **gethired-api** → URL `https://gethired-api.onrender.com`.
   If Render assigns a different URL (name taken), put that URL in `vercel.json`
   (`rewrites[0].destination`) and commit.
3. Fill in the prompted values (you'll know the Vercel URL after 5b — use the name you
   plan to pick, e.g. `https://gethired.vercel.app`, and fix it later if it differs):

   | Key | Value |
   |---|---|
   | `CLIENT_URL` | `https://gethired.vercel.app` (Vercel URL, no trailing slash) |
   | `API_URL` | `https://gethired-api.onrender.com` (this service; used by the email open-tracking pixel) |
   | `GMAIL_REDIRECT_URI` | `https://gethired.vercel.app/api/v1/gmail/callback` (**Vercel** domain) |
   | `MONGODB_URI` | from step 2 |
   | `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **store it safely** |
   | `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | from step 3 |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` (+ optional `GEMINI_TEXT_MODEL`) | AI Studio, billing on |
   | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | from step 4 |
   | `BREVO_API_KEY`, `MAIL_FROM` | Brevo → SMTP & API → API keys; `MAIL_FROM` = a sender verified in Brevo (`GetHired <you@gmail.com>`) |

   Pre-set by the blueprint: `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=2`
   (browser → Vercel → Render = 2 hops), generated JWT secrets, and the free-profile knobs
   (`OCR_ENABLED=false`, `BCRYPT_COST=10`, low concurrency, 14-day screenshot retention).
4. Build: `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @jobmail/shared build && pnpm --filter @jobmail/server build`
   · Start: `pnpm start` · Health check: `/health`.
5. Check: `https://gethired-api.onrender.com/health` → `{"ok":true,"db":"up"}`.

### 5b. Vercel — frontend
1. Vercel → Add New → Project → import the same repo.
2. **Root Directory: leave as the repo root** (`./`). `vercel.json` sets everything:
   install `pnpm install --frozen-lockfile`, build `pnpm --filter @jobmail/shared build && pnpm --filter @jobmail/client build`,
   output `client/dist`, the `/api` proxy, SPA fallback, security headers, and no CDN caching for `/api`.
3. Environment variables: `VITE_CONTACT_EMAIL` = your support email (shown on `/privacy`);
   later `VITE_GEMINI_PAID=true` once Gemini billing is on.
   Do **not** set `VITE_API_URL`.
4. Deploy. If the URL isn't the one you used in 5a, update `CLIENT_URL` and
   `GMAIL_REDIRECT_URI` on Render (Render redeploys automatically).
5. Check: `https://gethired.vercel.app/api/v1/auth/me` → `401` JSON (proxy works).

### 5c. Google Cloud
Authorized redirect URI = exactly `GMAIL_REDIRECT_URI` (the **Vercel** URL). Homepage and
privacy policy on the consent screen = the Vercel/custom domain (`/privacy`).

### 5d. Keep the free Render API awake (free tier only)
Render Free sleeps after 15 min without traffic (next request waits ~1 min, and scheduled
follow-ups only run while it's awake). Free fix: [UptimeRobot](https://uptimerobot.com)
(or cron-job.org) → HTTP monitor → `https://gethired-api.onrender.com/health` every
**5 minutes**. One always-on service uses ~744 of Render's 750 free hours/month — don't run
a second free service in the same Render workspace.

### 5e. Google OAuth on the free setup (no custom domain)
OAuth consent screen → **Publish app** (status "In production", unverified). Anyone can
connect (up to **100 users total**); they see "Google hasn't verified this app" →
*Advanced* → *Go to GetHired*. Better than "Testing" mode: no manual test-user list and
no 7-day token expiry. To go past 100: custom domain + verification (§4).

### 5f. Custom domain (recommended; needed for Google verification)
Add it in **Vercel** (e.g. `gethired.in`) — Render keeps its onrender.com URL behind the
proxy. Then update `CLIENT_URL`, `GMAIL_REDIRECT_URI` (Render) and the Google redirect URI.

Limits of the proxy: Vercel allows 120 s per proxied request (the API's slowest call,
email generation, is capped below that) — uploads (≤10 MB) are proxied fine but
**test a large résumé upload once after deploying**.

## 6. After the first deploy — check the logs
The server logs a warning at boot for each missing piece:
- `COOKIE_SECURE=false in production` → set `COOKIE_SECURE=true`
- `No system mail sender configured` → verification emails won't arrive
- `Gmail OAuth is not configured` → nobody can send outreach
- `ImageKit is not configured` → uploads land on local disk and vanish on redeploy
- `GEMINI_API_KEY is empty` → extraction falls back to OCR/regex
- `API_URL points at localhost` → open tracking won't work

It **refuses to start** in production if the JWT secrets are the `change-me` placeholders,
shorter than 32 chars, or identical to each other; and exits if MongoDB is unreachable (so Render
restarts it instead of serving a broken app).

## 7. Smoke test on the live URL
1. `https://gethired-api.onrender.com/health` → `{"ok":true,"db":"up"}`; `/health/queue` → `"ok":true`
2. Register → verification email arrives → click link
3. Settings → upload resume → Connect Gmail → consent → back to Settings, connected
4. New application → paste a JD or upload a screenshot → generate email → send to
   **your own second address** → check it arrives with the resume attached
5. Open the email → Pipeline/Dispatches shows it as opened

## 8. Capacity — what's built in for ~1000 users

Measured on 1 CPU (the Standard plan's size), production build:

| Check | Result |
|---|---|
| Landing page | ~1,600 req/s, p99 86 ms (gzip + immutable cached assets) |
| Typical API reads (`/applications`, `/analytics`, `/notifications`) | 700–1,000 req/s per endpoint (small per-user data; real numbers depend on the Atlas tier) |
| Register/login (bcrypt cost 12, native) | ~3.5/s per CPU; event loop stays responsive (p99 delay 9 ms vs ~1 s before) |
| 60 simultaneous 2560×3414 screenshot uploads | all accepted in 1.2 s; RAM peak ~570 MB (OCR fallback) |
| 200 simultaneous extractions | queued, 4 at a time, none lost |

What protects the app at that scale:
- **Rate limits per user / per account**, not per IP — a whole classroom on one Wi-Fi
  doesn't share one bucket. `TRUST_PROXY` must match the proxy hops (Render = 1).
- **Upload gate** (8 in RAM at once) and **extraction queue** (4 Gemini/OCR at once) —
  bursts wait instead of crashing the instance or hammering Gemini into 429s.
- **Crash-safe extraction** — jobs left "processing" by a deploy/restart are re-run
  from storage after 15 min (max 3 tries, then the manual-entry form).
- **Queue hygiene** — completed send/follow-up jobs are deleted; 5 sends in parallel.
- **Storage stays flat** — screenshots auto-deleted after `SCREENSHOT_RETENTION_DAYS`
  (30); the browser re-encodes big screenshots to WebP ≤2000 px before upload.
- `/health` returns 503 when MongoDB is down, so Render restarts the instance.

Rough monthly cost at 1000 users × 30 applications each (30k applications):
Render $25 + Atlas Flex ~$15 + ImageKit $0–9 + Gemini ~$150 (Flash-Lite for text) to
~$400 (Flash for everything; list prices double from Jan 2027) ≈ **$200–450/mo**.
Gemini is the variable part: ~12k input + ~1.2k output tokens per application.

Scaling further: Render → 2+ instances works as-is (Vercel just proxies) (Agenda locks jobs; sweeps claim
atomically). Rate limits are per instance then (effectively ×N). ImageKit storage: at
~300 KB/screenshot, 3 GB free ≈ 10k screenshots — lower `SCREENSHOT_RETENTION_DAYS` or
upgrade.

## 9. Before sharing it publicly
- Review `/privacy` (not legal advice) and set `VITE_CONTACT_EMAIL`.
- Keep the default daily send cap (30) and human review; auto-send is opt-in.
- Atlas → enable backups (M10+), or a periodic `mongodump`.
