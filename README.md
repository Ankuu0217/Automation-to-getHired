<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white" alt="Node 20" />
  <img src="https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Gemini_AI-Vision-4285F4?logo=google&logoColor=white" alt="Gemini AI" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Gmail_OAuth2-API-EA4335?logo=gmail&logoColor=white" alt="Gmail OAuth2" />
</p>

<h1 align="center">🚀 GetHired — AI-Powered Job Outreach Automation</h1>

<p align="center">
  <strong>Turn LinkedIn job screenshots into sent, tracked &amp; personalized HR outreach emails — in seconds.</strong>
</p>

<p align="center">
  <em>Upload a screenshot → AI extracts the job details → get a personalized email draft → review &amp; send from your own Gmail — with resume auto-attached, open tracking, automated follow-ups, and a full analytics dashboard.</em>
</p>

---

## 🎯 The Problem

Job seekers spend **hours** manually copying job details, crafting personalized emails, and tracking application statuses across spreadsheets. Most outreach emails go unread because they're generic and poorly timed.

## 💡 The Solution

**GetHired** automates the entire cold outreach pipeline while keeping you in control:

```
📸 Screenshot → 🤖 AI Extraction → ✍️ Personalized Email → 👀 Your Review → 📤 Sent via Your Gmail → 📊 Tracked
```

---

## ✨ Key Features

### 🤖 AI-Powered Job Extraction
- Upload a LinkedIn job screenshot — Gemini Vision AI extracts **company, role, location, JD, HR name &amp; email** with confidence scores
- Fallback chain: Vision AI → Tesseract.js OCR → Regex heuristics (never fails)
- Smart **deduplication** prevents applying to the same job twice

### ✉️ Personalized Email Generation
- AI compares the job description against your **profile &amp; resume** to generate hyper-personalized outreach
- Highlights **matched skills**, identifies **gaps**, and crafts a compelling **angle**
- Multiple email templates with customizable tones — `formal`, `confident`, or `friendly`

### 📬 Gmail OAuth2 Integration
- Sends emails from **your own Gmail** (not a third-party sender) for maximum deliverability
- Resume auto-attached as `FirstName_LastName_Resume.pdf`
- OAuth2 tokens encrypted at rest with **AES-256-GCM**

### 📊 Kanban Pipeline &amp; Analytics
- Drag-and-drop **Kanban board**: Applied → HR Screen → Interview → Offer / Rejected
- **Open tracking** via invisible pixel — know exactly when your email was read
- **Funnel analytics**: sent → opened → replied → interviews, response rate by template
- Weekly streaks, role category breakdown, and activity timeline

### 🔁 Automated Follow-ups
- Configurable follow-up emails on **Day 3** and **Day 7**
- Auto-stops on: reply, bounce, stage change to `rejected` or `offer`
- Smart jitter (2–8 min between sends) for natural sending patterns

### 🛡️ Deliverability Guardrails
- Daily send cap (default 30) with 10/hour ceiling
- MX record pre-validation before every send
- Multipart `text/plain` + `text/html` emails
- Human-in-the-loop by default — auto-send is opt-in

### 📦 Batch Processing
- Upload **multiple screenshots** at once for bulk job extraction
- Review and send outreach for multiple jobs in one session

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Client (React + Vite)                          │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Landing   │  │  Dashboard   │  │ New App Flow │  │  Pipeline    │ │
│  │  Page      │  │  + Stats     │  │ (AI Magic)   │  │  (Kanban)    │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Templates │  │  Analytics   │  │  Contacts    │  │  Settings    │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│                    TanStack Query • Zustand • Tailwind                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ httpOnly Cookies (JWT)
┌───────────────────────────────▼─────────────────────────────────────────┐
│                         Server (Express + TS)                           │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Auth/JWT  │  │ Profile/Jobs │  │ Gmail OAuth  │  │ Applications │ │
│  │  + Refresh │  │  + Resume    │  │  + Mailer    │  │  + Pipeline  │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Templates │  │  Analytics   │  │ Agenda Queue │  │ Tracking     │ │
│  │  + Stats   │  │  + Funnel    │  │  (MongoDB)   │  │  Pixel       │ │
│  └────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│                     Gemini Vision AI • Tesseract OCR                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                         MongoDB (Docker Compose)                        │
│              Collections • Queue Jobs • Encrypted Tokens                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite, TypeScript (strict), Tailwind CSS, TanStack Query, Zustand, React Router v6, Framer Motion, Recharts, dnd-kit, react-hook-form + Zod |
| **Backend** | Node.js 20, Express, TypeScript (strict), Mongoose, Agenda (job queue), Nodemailer, Gmail OAuth2, Multer |
| **AI Engine** | Google Gemini Vision API (primary), Tesseract.js OCR (fallback) |
| **Database** | MongoDB via Docker Compose |
| **Security** | bcrypt(12), JWT with httpOnly SameSite=Strict cookies, refresh token rotation, AES-256-GCM encryption, Helmet, CORS whitelist, rate limiting, mongo sanitization |
| **Shared** | Zod schemas &amp; TypeScript types (`/shared`) |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 20
- pnpm
- Docker (for MongoDB)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-username/getHired.git
cd getHired

# 2. Install dependencies
pnpm install

# 3. Start MongoDB
docker compose up -d

# 4. Configure environment
cp server/.env.example server/.env
# Edit server/.env with your keys (see Environment Variables below)

# 5. Run the app (client + server + shared)
pnpm dev
```

The app will be available at **http://localhost:5173** with the API at **http://localhost:4000**.

---

## ⚙️ Environment Variables

### Server (`server/.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `JWT_SECRET` | ✅ | Access token signing secret |
| `JWT_REFRESH_SECRET` | ✅ | Refresh token signing secret |
| `ENCRYPTION_KEY` | ✅ | 32-byte AES-256-GCM key (64 hex chars) |
| `GEMINI_API_KEY` | ✅ | Google AI API key for vision extraction |
| `GMAIL_CLIENT_ID` | For OAuth | Google OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | For OAuth | Google OAuth2 client secret |
| `GMAIL_REDIRECT_URI` | For OAuth | OAuth callback URL |
| `GMAIL_USER` | Dev fallback | Gmail address for App Password mode |
| `GMAIL_APP_PASSWORD` | Dev fallback | Gmail app password |

Generate a secure encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📜 Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Builds shared package, then runs client + server concurrently |
| `pnpm build` | Production build of all packages |
| `pnpm lint` | Type-checks all packages |
| `pnpm seed` | Seeds demo user with 6 sample applications across all stages |

### Demo Account (after seeding)
- **Email:** `demo@jobmail.dev`
- **Password:** `Demo1234!`

---

## 🔐 Security Highlights

- **Authentication:** bcrypt(12) password hashing, JWT access + refresh tokens in httpOnly SameSite=Strict cookies with automatic rotation
- **Encryption:** Gmail OAuth tokens encrypted at rest with AES-256-GCM
- **API Protection:** Helmet security headers, CORS whitelist, express-rate-limit, express-mongo-sanitize, pino log redaction
- **Email Safety:** MX pre-validation, daily/hourly send caps, human-in-the-loop review

---

## 🎯 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **MongoDB-only queue (Agenda)** | Keeps the stack pure MERN — no Redis dependency needed |
| **Human-in-the-loop by default** | Emails are drafted and queued only after explicit review; auto-send is opt-in |
| **Gemini Vision over OCR** | Directly reads screenshots via multimodal AI — far more reliable than raw OCR on LinkedIn UI |
| **Own Gmail as sender** | Sending from user's own account maximizes deliverability vs. shared SMTP |
| **Deliverability jitter** | 2–8 min random delays between sends mimics natural human sending patterns |

---

## 📂 Project Structure

```
getHired/
├── client/                 # React + Vite frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Route pages (Landing, Dashboard, Pipeline, etc.)
│   │   ├── lib/            # Utilities, API client, hooks
│   │   └── stores/         # Zustand state stores
│   └── public/             # Static assets
├── server/                 # Express + TypeScript backend
│   ├── src/
│   │   ├── routes/         # API route handlers
│   │   ├── models/         # Mongoose schemas
│   │   ├── services/       # Business logic (AI, mailer, queue)
│   │   ├── middleware/     # Auth, validation, error handling
│   │   └── config/         # Environment validation
│   └── uploads/            # User uploads (screenshots, resumes)
├── shared/                 # Shared Zod schemas &amp; TypeScript types
├── docker-compose.yml      # MongoDB container
└── package.json            # Monorepo root (pnpm workspaces)
```

---

## ⚠️ Disclaimer

You are responsible for complying with anti-spam laws (CAN-SPAM, GDPR) and platform terms of service. GetHired enforces send caps, requires explicit human review by default, and provides manual controls — **use them responsibly**.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/your-username">Ankit Singh</a>
</p>
