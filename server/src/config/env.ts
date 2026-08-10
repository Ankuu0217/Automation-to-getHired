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
  SMTP_HOST: z.string().optional().or(z.literal('')),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional().or(z.literal('')),
  SMTP_PASS: z.string().optional().or(z.literal('')),
  // M3+ (queue) — 'true' runs Agenda jobs inline/synchronously. Default is true
  // in development so local testing sends immediately without depending on the
  // Agenda worker loop; production uses the persisted queue by default.
  QUEUE_INLINE: z
    .enum(['true', 'false'])
    .default(process.env.NODE_ENV === 'production' ? 'false' : 'true')
    .transform((v) => v === 'true'),
});

const parsed = envSchema.safeParse(process.env);

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
