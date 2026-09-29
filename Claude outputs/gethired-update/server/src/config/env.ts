import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  CLIENT_URL: z.string().url(),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 32 bytes as 64 hex characters'),
  // Optional versioned keyring for rotation: "NN:hex64,NN:hex64,…" (NN = 2 hex
  // digits = key version; the FIRST entry is primary/encrypts, the rest stay
  // available for decrypt). When unset, ENCRYPTION_KEY is used as version 00.
  // Validated at BOOT (same fail-fast as ENCRYPTION_KEY) so a rotation typo can't
  // become a runtime outage on the first crypto op.
  ENCRYPTION_KEYS: z
    .string()
    .optional()
    .or(z.literal(''))
    .refine(
      (v) =>
        !v ||
        v.split(',').every((e) => /^[0-9a-fA-F]{2}:[0-9a-fA-F]{64}$/.test(e.trim())),
      'ENCRYPTION_KEYS must be comma-separated "NN:<64 hex>" entries (NN = 2 hex digits)',
    ),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // M2+ (AI extraction) — optional now
  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  // Default to the "latest flash" alias — a pinned old version (e.g.
  // gemini-1.5-flash) gets retired by Google and every AI call then 404s and
  // silently degrades to the regex fallback. Override with a pinned version in
  // .env if you need reproducibility.
  GEMINI_MODEL: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : 'gemini-flash-latest')),
  // OpenRouter (primary AI when set): one key, many models. Free models rotate,
  // so we try a chain — the configured list first, then free models discovered
  // live from OpenRouter, then the openrouter/free router. Comma-separated ids.
  OPENROUTER_API_KEY: z.string().optional().or(z.literal('')),
  OPENROUTER_MODELS: z.string().optional().or(z.literal('')),
  OPENROUTER_VISION_MODELS: z.string().optional().or(z.literal('')),
  // M3+ (Gmail OAuth) — optional: /gmail/connect returns 503 OAUTH_NOT_CONFIGURED without these
  GMAIL_CLIENT_ID: z.string().optional().or(z.literal('')),
  GMAIL_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GMAIL_REDIRECT_URI: z.string().url().optional().or(z.literal('')),
  // M3+ (dev send fallback) — used when a user has no Gmail OAuth connected
  GMAIL_USER: z.string().optional().or(z.literal('')),
  GMAIL_APP_PASSWORD: z.string().optional().or(z.literal('')),
  // System transactional mail (email verification) — a no-reply sender that does
  // NOT depend on any user's Gmail. All optional: without SMTP/app-password the
  // dev fallback (jsonTransport + logged link) keeps local/test from sending.
  MAIL_FROM: z.string().optional().or(z.literal('')),
  // Brevo transactional email over HTTPS (free: 300/day). Preferred over SMTP —
  // works on hosts that block SMTP ports (e.g. Render free). MAIL_FROM must be a
  // sender verified in Brevo.
  BREVO_API_KEY: z.string().optional().or(z.literal('')),
  SMTP_HOST: z.string().optional().or(z.literal('')),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional().or(z.literal('')),
  SMTP_PASS: z.string().optional().or(z.literal('')),
  // File storage (resumes + screenshots). When both are set, uploads go to
  // ImageKit as PRIVATE files (served only via short-lived signed URLs) and
  // the server keeps nothing on disk. Unset → local disk under server/uploads.
  IMAGEKIT_PRIVATE_KEY: z.string().optional().or(z.literal('')),
  IMAGEKIT_URL_ENDPOINT: z.string().url().optional().or(z.literal('')),
  IMAGEKIT_FOLDER: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => '/' + (v && v.length > 0 ? v : 'gethired').replace(/^\/+|\/+$/g, '')),
  // ── Scale knobs (defaults sized for one 1 CPU / 2 GB instance) ──
  // Express `trust proxy`: hops of reverse proxies in front of the app (Render,
  // Railway, Fly, Nginx = 1). Wrong value ⇒ every user shares one rate-limit IP.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  // Max multipart uploads buffered in RAM at once (each ≤10 MB); extra requests queue.
  UPLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),
  // Max screenshot/text extractions (Gemini vision + OCR fallback) running at once.
  EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  // Parallel send-email / follow-up jobs per instance (each user's Gmail is separate).
  QUEUE_SEND_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  // Delete stored job screenshots after N days (the extracted data is kept). 0 = keep forever.
  SCREENSHOT_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  // OCR fallback (tesseract) when Gemini can't read a screenshot. CPU-heavy:
  // ~7 s per screenshot on 1 CPU, ~1 min on a 0.1-CPU free instance, and
  // ~150 MB RAM. 'false' on tiny/free hosts → the user gets the manual-entry form.
  OCR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Password hashing cost. 12 ≈ 0.3 s per login on 1 CPU; on a 0.1-CPU free
  // instance use 10 (≈0.7 s). Existing hashes keep working at any setting.
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
  // Optional cheaper model for text-only calls (pasted JD, match analysis, email
  // writing). Vision (screenshots) always uses GEMINI_MODEL. Unset = GEMINI_MODEL.
  GEMINI_TEXT_MODEL: z.string().optional().or(z.literal('')),
  // M3+ (queue) — 'true' runs Agenda jobs inline/synchronously. Default is true
  // in development so local testing sends immediately without depending on the
  // Agenda worker loop; production uses the persisted queue by default.
  QUEUE_INLINE: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema
  .superRefine((cfg, ctx) => {
    if (Boolean(cfg.IMAGEKIT_PRIVATE_KEY) !== Boolean(cfg.IMAGEKIT_URL_ENDPOINT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IMAGEKIT_URL_ENDPOINT'],
        message: 'Set BOTH IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT (or neither for local disk storage)',
      });
    }
    if (cfg.NODE_ENV !== 'production') return;
    // Refuse to boot production with the placeholder secrets from .env.example —
    // anyone who has read the repo could forge sessions.
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (cfg[key].startsWith('change-me') || cfg[key].length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be a unique random string of 32+ characters in production`,
        });
      }
    }
    if (cfg.JWT_SECRET === cfg.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_SECRET',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment configuration:\n${issues}\n\nSee server/.env.example.\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
