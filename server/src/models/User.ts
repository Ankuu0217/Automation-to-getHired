import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { defaultSettings, type Tone, type UserSettings } from '@jobmail/shared';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  gmailAuth: {
    accessTokenEnc?: string;
    refreshTokenEnc?: string;
    expiry?: Date;
    connectedEmail?: string;
  };
  settings: UserSettings;
  /** SHA-256 hashes of live refresh tokens (rotation: replaced on each use). */
  refreshTokenHashes: string[];
  /** Last send-pipeline failure (e.g. Gmail disconnected mid-queue), null when healthy. */
  lastSendError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    gmailAuth: {
      accessTokenEnc: { type: String, select: false },
      refreshTokenEnc: { type: String, select: false },
      expiry: { type: Date, select: false },
      connectedEmail: { type: String },
    },
    settings: {
      autoSend: { type: Boolean, default: defaultSettings.autoSend },
      dailySendCap: { type: Number, default: defaultSettings.dailySendCap, min: 1, max: 100 },
      followUpEnabled: { type: Boolean, default: defaultSettings.followUpEnabled },
      tone: {
        type: String,
        enum: ['formal', 'confident', 'friendly'] satisfies Tone[],
        default: defaultSettings.tone,
      },
    },
    refreshTokenHashes: { type: [String], default: [], select: false },
    /** Last send-pipeline failure (e.g. Gmail disconnected mid-queue) — read by the UI banner. */
    lastSendError: { type: String, default: null },
  },
  { timestamps: true },
);

// Idempotent registration: vitest runs all files in one fork with a shared
// mongoose instance, so a naive model() call throws OverwriteModelError.
export const User =
  (mongoose.models.User as mongoose.Model<IUser>) ?? mongoose.model<IUser>('User', userSchema);
