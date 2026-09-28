# Going live — GetHired

One Node web service serves **both** the API and the built React app (same origin),
backed by **MongoDB Atlas**. Same-origin matters: auth cookies are `SameSite=Strict`,
so splitting the frontend (e.g. Vercel) and API (e.g. Render) onto different domains
would break login.

## 1. Accounts you need

| What | Why | Cost (≈1000 users) |
|---|---|---|
| Domain name | OAuth verification needs a homepage + privacy policy on **your own domain** | ~₹800/yr |
| Render — **Standard** (1 CPU / 2 GB) | Hosts app + API; stays awake so follow-ups fire on time | $25/mo |
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
3. That's it. Files are uploaded as **private** under `/gethired/{resumes,screenshots}/<userId>/`
   and are only reachable through signed URLs that expire (2 min for server fetches,
   1 h for screenshot previews). Replaced resumes and deleted accounts remove their files.
4. Files uploaded before you set these keys stay on local disk and keep working locally;
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

## 5. Deploy on Render
1. Push this repo to GitHub (it already includes `render.yaml`).
2. Render → New → **Blueprint** → select the repo.
3. Fill in the prompted values:
   - `API_URL` and `CLIENT_URL` → both `https://gethired.onrender.com` (or your domain), no trailing slash
   - `MONGODB_URI` → from step 2
   - `ENCRYPTION_KEY` → `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     (**store it safely** — lose it and every saved Gmail connection is unreadable)
   - `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` → from step 3
   - `GEMINI_API_KEY` (billing-enabled project), `GEMINI_MODEL` (pin an ID from AI Studio),
     optional `GEMINI_TEXT_MODEL` (a Flash-Lite ID to cut text-call cost ~3×)
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`
   - `VITE_CONTACT_EMAIL` → shown on /privacy
   - `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` (or leave SMTP empty and set
     `GMAIL_USER` + `GMAIL_APP_PASSWORD` as the system sender)
   - `JWT_SECRET` / `JWT_REFRESH_SECRET` are generated automatically.
4. Build: `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm build`
   Start: `pnpm start` · Health check: `/health`
   (`--prod=false` is required: with `NODE_ENV=production`, pnpm otherwise skips the
   TypeScript/Vite dev dependencies the build needs.)
5. Custom domain: Render → Settings → Custom Domains, then update `API_URL`,
   `CLIENT_URL`, `GMAIL_REDIRECT_URI` and the Google redirect URI to match.

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
1. `https://YOUR-DOMAIN/health` → `{"ok":true}`; `/health/queue` → `"ok":true`
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

Scaling further: Render → 2+ instances works as-is (Agenda locks jobs; sweeps claim
atomically). Rate limits are per instance then (effectively ×N). ImageKit storage: at
~300 KB/screenshot, 3 GB free ≈ 10k screenshots — lower `SCREENSHOT_RETENTION_DAYS` or
upgrade.

## 9. Before sharing it publicly
- Review `/privacy` (not legal advice) and set `VITE_CONTACT_EMAIL`.
- Keep the default daily send cap (30) and human review; auto-send is opt-in.
- Atlas → enable backups (M10+), or a periodic `mongodump`.
