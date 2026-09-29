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
    /** Set when a token is found revoked/expired at Google — the UI shows a
     *  "reconnect" state and sending stays paused until the user re-consents. */
    needsReconnect?: boolean;
    /** The grant includes gmail.readonly → replies from HR are detected automatically. */
    canReadReplies?: boolean;
    /** Last successful reply poll (next poll only asks Gmail for newer mail). */
    repliesCheckedAt?: Date;
  };
  settings: UserSettings;
  /** SHA-256 hashes of live refresh tokens (rotation: replaced on each use). */
  refreshTokenHashes: string[];
  /** Last send-pipeline failure (e.g. Gmail disconnected mid-queue), null when healthy. */
  lastSendError: string | null;
  /** SHA-256 of the browser-extension API token (the token itself is shown once). */
  extensionTokenHash?: string | null;
  extensionTokenCreatedAt?: Date | null;
  /** Whether the account email is verified — the send pipeline is gated on this. */
  emailVerified: boolean;
  /**
   * Pending email-verification token (select:false, never leaves the DB by
   * default). Only the sha256 of the token is stored; issuing a new one
   * overwrites this, and a successful verify unsets it (single-use + rotation).
   */
  emailVerification?: {
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
  };
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
      // Not select:false — toPublicUser reads it to derive the connection status.
      needsReconnect: { type: Boolean },
      canReadReplies: { type: Boolean, default: false },
      repliesCheckedAt: { type: Date },
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
      /** Weekly send target for the dashboard — null when no goal is set. */
      weeklySendGoal: { type: Number, default: defaultSettings.weeklySendGoal, min: 1, max: 100 },
    },
    refreshTokenHashes: { type: [String], default: [], select: false },
    /** Last send-pipeline failure (e.g. Gmail disconnected mid-queue) — read by the UI banner. */
    lastSendError: { type: String, default: null },
    extensionTokenHash: { type: String, default: null, select: false, index: { sparse: true } },
    extensionTokenCreatedAt: { type: Date, default: null },
    emailVerified: { type: Boolean, default: false, index: true },
    emailVerification: {
      type: new Schema(
        {
          // sparse index → O(1) lookup on verify, no penalty for the null-common case
          tokenHash: { type: String, index: { sparse: true } },
          expiresAt: { type: Date },
          sentAt: { type: Date },
        },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },
  },
  { timestamps: true },
);

// Idempotent registration: vitest runs all files in one fork with a shared
// mongoose instance, so a naive model() call throws OverwriteModelError.
export const User =
  (mongoose.models.User as mongoose.Model<IUser>) ?? mongoose.model<IUser>('User', userSchema);
