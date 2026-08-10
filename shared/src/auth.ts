import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Body of POST /auth/verify-email — the raw token from the email link. */
export const verifyEmailSchema = z.object({
  token: z.string().min(20, 'Invalid verification token'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/** Public user shape returned by the API (never includes passwordHash/tokens). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  gmailConnected: boolean;
  /** True when the server has a dev-only app-password fallback configured. */
  hasEmailFallback: boolean;
  connectedEmail: string | null;
  /**
   * Gmail connection health for the Settings card:
   *  - 'connected'       — a live, working connection
   *  - 'needs_reconnect' — a token was revoked/expired at Google (still shows the
   *                        address, but sending is paused until the user reconnects)
   *  - 'disconnected'    — no Gmail linked
   */
  gmailStatus: 'connected' | 'needs_reconnect' | 'disconnected';
  /** Last send-pipeline error (e.g. Gmail disconnected mid-queue) — drives the UI banner. */
  lastSendError: string | null;
  /** Whether the account's email is verified — the send pipeline is gated on this. */
  emailVerified: boolean;
  settings: UserSettings;
  createdAt: string;
}

export const toneEnum = z.enum(['formal', 'confident', 'friendly']);
export type Tone = z.infer<typeof toneEnum>;

export const settingsSchema = z.object({
  autoSend: z.boolean(),
  dailySendCap: z.number().int().min(1).max(100),
  followUpEnabled: z.boolean(),
  tone: toneEnum,
  /** Weekly send target shown on the dashboard — null when no goal is set. */
  weeklySendGoal: z.number().int().min(1).max(100).nullable(),
});
export type UserSettings = z.infer<typeof settingsSchema>;

/** PATCH body — all fields optional, at least one required. */
export const settingsUpdateSchema = settingsSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'At least one setting must be provided' },
);
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
/** Alias kept for client ergonomics. */
export type UpdateSettingsInput = SettingsUpdateInput;

export const defaultSettings: UserSettings = {
  autoSend: false,
  dailySendCap: 30,
  followUpEnabled: true,
  tone: 'formal',
  weeklySendGoal: null,
};
