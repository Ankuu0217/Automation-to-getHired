# JobMail Autopilot

Turn LinkedIn job-post screenshots into sent, tracked, personalized HR outreach emails — sent from your own Gmail account with your resume auto-attached.

> **Core loop:** screenshot → AI extraction → match analysis → personalized email draft → your review → queued send → Kanban pipeline → follow-ups → analytics.

## Tech stack

- **Frontend:** React 18 + Vite + TypeScript (strict), Tailwind CSS + shadcn-style components, TanStack Query, Zustand, React Router v6, react-hook-form + zod, react-dropzone, dnd-kit, Recharts, sonner, framer-motion
- **Backend:** Node 20 + Express + TypeScript (strict), Mongoose, Agenda (MongoDB-backed queue), Nodemailer + Gmail OAuth2, Gemini vision AI + tesseract.js OCR fallback
- **Shared:** Zod schemas & TypeScript types (`/shared`)
- **Infra:** MongoDB via Docker Compose

## Quick start

```bash
# 1. Clone and install
pnpm install

# 2. Start MongoDB
docker compose up -d

# 3. Configure server env
cp server/.env.example server/.env
# Edit server/.env — see required variables below

# 4. Run everything (client + server + shared build)
pnpm dev
```

The Vite dev server proxies `/api/v1` to the Express backend, so both apps work on the same origin (`http://localhost:5173`).

## Environment variables

### Server (`server/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | yes | `development` or `production` |
| `PORT` | yes | Server port (default `4000`) |
| `API_URL` | yes | Public server URL, used for tracking pixels |
| `CLIENT_URL` | yes | Allowed CORS origin |
| `MONGODB_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | Access-token secret |
| `JWT_REFRESH_SECRET` | yes | Refresh-token secret |
| `ENCRYPTION_KEY` | yes | 32-byte AES-256-GCM key as 64 hex chars |
| `COOKIE_SECURE` | yes | `false` for local HTTP, `true` for HTTPS |
| `GEMINI_API_KEY` | for AI | Google AI API key for vision extraction |
| `GEMINI_MODEL` | no | Override model (defaults to `gemini-1.5-flash`) |
| `GMAIL_CLIENT_ID` | for OAuth | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | for OAuth | Google OAuth client secret |
| `GMAIL_REDIRECT_URI` | for OAuth | Must match Google console, e.g. `http://localhost:4000/api/v1/gmail/callback` |
| `GMAIL_USER` | dev fallback | Gmail address for app-password fallback |
| `GMAIL_APP_PASSWORD` | dev fallback | Gmail app password |
| `QUEUE_INLINE` | no | `true` runs sends synchronously in tests/debug |

Generate a secure `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Client (`client/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_API_URL` | no | Override API base URL; defaults to same-origin `/api/v1` |

## Gmail OAuth setup

The app sends emails through the user’s own Gmail account using OAuth2. To enable it:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Click **Create Credentials** → **OAuth client ID**.
3. Set application type to **Web application**.
4. Add an authorized redirect URI: `http://localhost:4000/api/v1/gmail/callback` (or your production equivalent).
5. Copy the **Client ID** and **Client Secret** into `server/.env` as `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.
6. Enable the **Gmail API** and **Google People API** (for userinfo.email) in the library.

The requested scopes are:

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.readonly` (reserved for future reply-detection polling)
- `https://www.googleapis.com/auth/userinfo.email`

Tokens are encrypted at rest with AES-256-GCM and never logged.

### Dev fallback

If you skip OAuth setup, you can still send by setting `GMAIL_USER` + `GMAIL_APP_PASSWORD` in `server/.env`. In that mode the app falls back to a plain SMTP transport. The `/gmail/connect` endpoint returns `503 OAUTH_NOT_CONFIGURED` when OAuth is not configured.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Client (Vite)                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │  Landing   │  │  Dashboard   │  │ New App Flow │  │ Pipeline/Stats │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └────────────────┘ │
│                         TanStack Query + Zustand                        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ httpOnly cookies
┌───────────────────────────────▼─────────────────────────────────────────┐
│                           Server (Express)                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │  Auth/JWT  │  │ Profile/Jobs │  │ Gmail OAuth  │  │  Applications  │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └────────────────┘ │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │  Templates │  │  Analytics   │  │ Agenda Queue │  │ Tracking pixel │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └────────────────┘ │
│                         AI Provider (Gemini/OCR)                        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                            MongoDB (Docker)                             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Scripts

| Script | Runs |
|--------|------|
| `pnpm dev` | Builds shared, then runs client + server concurrently |
| `pnpm build` | Builds shared, server, and client for production |
| `pnpm test` | Runs server + client test suites |
| `pnpm lint` | Type-checks all packages |
| `pnpm seed` | Seeds demo user + 6 applications across all stages |

## Testing

```bash
# All tests
pnpm test

# Server only
pnpm --filter @jobmail/server test

# Client only
pnpm --filter @jobmail/client test
```

Server tests use `mongodb-memory-server` and `supertest`; the AI provider, mailer, and MX validator are mocked so no network credentials are required.

## Demo data

```bash
pnpm seed
```

Creates a demo account:

- **Email:** `demo@jobmail.dev`
- **Password:** `Demo1234!`

The demo user has a complete profile, two templates, and six applications across `applied`, `hr_screen`, `interview`, `offer`, `rejected`, and `ghosted` stages, with realistic email threads and tracking events.

## Key design decisions

- **MongoDB-only queue:** Agenda is used instead of Redis to keep the stack MERN-only.
- **Human-in-the-loop by default:** emails are drafted and queued only after explicit review; auto-send is an opt-in setting.
- **Deliverability guardrails:** daily caps, 10/hour ceiling, 2–8 min jitter between sends, MX pre-check, multipart text+HTML, resume renamed to `FirstName_LastName_Resume.pdf`.
- **Follow-ups stop on:** reply, bounce, or stage change to `rejected`/`offer`.
- **Security:** bcrypt(12), JWT in httpOnly SameSite=strict cookies with refresh rotation, AES-256-GCM token encryption, helmet, CORS whitelist, express-mongo-sanitize, rate limits, pino redaction.

## Disclaimer

You are responsible for complying with anti-spam laws and platform terms. JobMail Autopilot enforces send caps, requires explicit review by default, and provides one-click manual controls — use them.
