import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM authenticated encryption for secrets at rest (Gmail tokens, M3+).
 *
 * Payload format (base64): version(1B) | iv(12B) | authTag(16B) | ciphertext
 * A random IV per encryption; the GCM tag gives tamper detection on decrypt.
 *
 * VERSIONED KEYRING (rotation-safe). The leading version byte selects the key,
 * so the key can be rotated without bricking already-encrypted data: add a new
 * primary key, keep the old one for decrypt, and secrets re-encrypt lazily as
 * they're rewritten (e.g. the Gmail token on its next refresh).
 *   - ENCRYPTION_KEYS = "NN:hex64,NN:hex64,…" (NN = 2 hex digits = version; the
 *     FIRST entry is primary/encrypts). Optional.
 *   - ENCRYPTION_KEY (required) is used as the version-00 primary when
 *     ENCRYPTION_KEYS is unset, and is always kept as a decrypt key.
 * Legacy ciphertexts written before versioning (no version byte:
 * iv|authTag|ciphertext) still decrypt via a fallback on ENCRYPTION_KEY.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_LENGTH = 1;

interface Keyring {
  primaryVersion: number;
  keys: Map<number, Buffer>;
  legacyKey: Buffer;
}

let ring: Keyring | null = null;

function buildKeyring(): Keyring {
  const legacyKey = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const keys = new Map<number, Buffer>();
  let primaryVersion: number | null = null;

  if (env.ENCRYPTION_KEYS) {
    for (const raw of env.ENCRYPTION_KEYS.split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      const [vHex, kHex] = entry.split(':').map((s) => s.trim());
      const version = Number.parseInt(vHex, 16);
      if (!Number.isInteger(version) || version < 0 || version > 255 || !/^[0-9a-fA-F]{64}$/.test(kHex ?? '')) {
        throw new Error(`Invalid ENCRYPTION_KEYS entry: "${entry}" (expected "NN:<64 hex>")`);
      }
      keys.set(version, Buffer.from(kHex, 'hex'));
      if (primaryVersion === null) primaryVersion = version;
    }
  }

  if (primaryVersion === null) {
    // No keyring configured — ENCRYPTION_KEY is the version-00 primary.
    keys.set(0, legacyKey);
    primaryVersion = 0;
  } else if (!keys.has(0)) {
    // Keep ENCRYPTION_KEY available to decrypt any version-00 ciphertext.
    keys.set(0, legacyKey);
  }

  return { primaryVersion, keys, legacyKey };
}

function getRing(): Keyring {
  if (!ring) ring = buildKeyring();
  return ring;
}

/** Test-only: force the keyring to rebuild after mutating env in a test. */
export function _resetKeyringForTests(): void {
  ring = null;
}

function decryptWith(key: Buffer, iv: Buffer, authTag: Buffer, ciphertext: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function encrypt(plaintext: string): string {
  const { primaryVersion, keys } = getRing();
  const key = keys.get(primaryVersion)!;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([primaryVersion]), iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(payload: string): string {
  const data = Buffer.from(payload, 'base64');
  const { keys, legacyKey } = getRing();

  // Current format: version(1B) | iv | tag | ciphertext.
  if (data.length >= VERSION_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    const key = keys.get(data[0]);
    if (key) {
      const iv = data.subarray(VERSION_LENGTH, VERSION_LENGTH + IV_LENGTH);
      const authTag = data.subarray(VERSION_LENGTH + IV_LENGTH, VERSION_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = data.subarray(VERSION_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
      try {
        return decryptWith(key, iv, authTag, ciphertext);
      } catch {
        // Not a version-tagged payload after all (e.g. a legacy IV whose first
        // byte happens to match a known version) — fall through to legacy.
      }
    }
  }

  // Legacy format: iv | tag | ciphertext (no version byte), ENCRYPTION_KEY.
  if (data.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    return decryptWith(legacyKey, iv, authTag, ciphertext);
  }

  throw new Error('Invalid encrypted payload');
}

/** Non-reversible SHA-256 hash (refresh-token storage, dedupe hashes in M2+). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
