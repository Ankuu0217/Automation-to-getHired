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
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // M2+ (AI extraction) — optional now
  GEMINI_API_KEY: z.string().optional().or(z.literal('')),
  GEMINI_MODEL: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((v) => (v && v.length > 0 ? v : 'gemini-1.5-flash')),
  // M3+ (Gmail OAuth) — optional: /gmail/connect returns 503 OAUTH_NOT_CONFIGURED without these
  GMAIL_CLIENT_ID: z.string().optional().or(z.literal('')),
  GMAIL_CLIENT_SECRET: z.string().optional().or(z.literal('')),
  GMAIL_REDIRECT_URI: z.string().url().optional().or(z.literal('')),
  // M3+ (dev send fallback) — used when a user has no Gmail OAuth connected
  GMAIL_USER: z.string().optional().or(z.literal('')),
  GMAIL_APP_PASSWORD: z.string().optional().or(z.literal('')),
  // M3+ (queue) — 'true' runs Agenda jobs inline/synchronously (tests, local debugging)
  QUEUE_INLINE: z
    .enum(['true', 'false'])
    .default('false')
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
