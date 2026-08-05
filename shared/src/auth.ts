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

/** Public user shape returned by the API (never includes passwordHash/tokens). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  gmailConnected: boolean;
  connectedEmail: string | null;
  /** Last send-pipeline error (e.g. Gmail disconnected mid-queue) — drives the UI banner. */
  lastSendError: string | null;
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
};
