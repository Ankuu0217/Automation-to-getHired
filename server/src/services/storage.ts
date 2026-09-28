import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ImageKit, { toFile } from '@imagekit/nodejs';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * File storage for user uploads (resumes + job screenshots).
 *
 * Two drivers, chosen per WRITE by config:
 *  - ImageKit (IMAGEKIT_PRIVATE_KEY + IMAGEKIT_URL_ENDPOINT set): uploaded as
 *    PRIVATE files, readable only through short-lived signed URLs. Nothing is
 *    kept on the server's disk, so any host (even one without a persistent
 *    disk) works.
 *  - Local disk (default for dev/tests): server/uploads/<kind>/…
 *
 * The returned "storage key" is what the models persist (Profile.resumeFile.path,
 * JobPost.screenshotPath — field names kept for backward compatibility):
 *  - ImageKit: `ik://<fileId><filePath>`   e.g. ik://6512ab…/gethired/resumes/<uid>/cv_x1y2.pdf
 *  - Local:    the absolute file path (exactly what older records already hold)
 *
 * READS dispatch on the key itself, so records written before switching to
 * ImageKit stay readable from disk.
 */

export type StorageKind = 'resumes' | 'screenshots';

const IK_PREFIX = 'ik://';
const LOCAL_ROOT = path.resolve(__dirname, '../../uploads');
/** Signed URLs used for server-side fetches only need to live for the request. */
const FETCH_URL_TTL_S = 120;
const FETCH_TIMEOUT_MS = 20_000;

/** The remote store (ImageKit) refused or could not be reached — surfaced as 503, logged with the reason. */
export class StorageUnavailableError extends Error {
  constructor(
    public readonly operation: 'upload' | 'download' | 'delete',
    public readonly status: number | null,
    reason: string,
  ) {
    super(`ImageKit ${operation} failed${status ? ` (HTTP ${status})` : ''}: ${reason}`);
    this.name = 'StorageUnavailableError';
  }
}

/** Human hint for the most common ImageKit misconfigurations. */
export function imageKitHint(status: number | null): string {
  if (status === 401) return 'IMAGEKIT_PRIVATE_KEY is wrong (use the PRIVATE key, starts with "private_").';
  if (status === 403) return 'The key lacks permission or the plan blocks this action (check the ImageKit dashboard).';
  if (status === 404) return 'IMAGEKIT_URL_ENDPOINT does not match your account (https://ik.imagekit.io/<your_id>).';
  if (status === 429) return 'ImageKit rate limit / plan quota reached.';
  if (status === null) return 'Network error reaching ImageKit (DNS/firewall/proxy?).';
  return 'See the ImageKit dashboard / status page.';
}

function toUnavailable(operation: 'upload' | 'download' | 'delete', err: unknown): StorageUnavailableError {
  const status = (err as { status?: number } | null)?.status ?? null;
  const reason = (err as { message?: string } | null)?.message ?? String(err);
  return new StorageUnavailableError(operation, typeof status === 'number' ? status : null, reason.slice(0, 300));
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Stored file not found: ${key.startsWith(IK_PREFIX) ? 'imagekit' : 'local'}`);
    this.name = 'StorageNotFoundError';
  }
}

/* ── ImageKit client (lazy; swappable in tests) ─────────────────────── */

type ImageKitLike = Pick<ImageKit, 'files' | 'helper'>;
let ikClient: ImageKitLike | null = null;
let ikOverride: ImageKitLike | null = null;

export function isImageKitEnabled(): boolean {
  return ikOverride !== null || Boolean(env.IMAGEKIT_PRIVATE_KEY && env.IMAGEKIT_URL_ENDPOINT);
}
/** Test hook: inject a fake ImageKit client (null restores config-driven behaviour). */
export function __setImageKitClientForTests(client: ImageKitLike | null): void {
  ikOverride = client;
}

function getIk(): ImageKitLike {
  if (ikOverride) return ikOverride;
  if (!ikClient) ikClient = new ImageKit({ privateKey: env.IMAGEKIT_PRIVATE_KEY! });
  return ikClient;
}

function urlEndpoint(): string {
  return env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/test';
}

function parseIkKey(key: string): { fileId: string; filePath: string } {
  const rest = key.slice(IK_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) throw new StorageNotFoundError(key);
  return { fileId: rest.slice(0, slash), filePath: rest.slice(slash) };
}

export function isRemoteKey(key: string): boolean {
  return key.startsWith(IK_PREFIX);
}

/* ── Public API ─────────────────────────────────────────────────────── */

export interface PutOptions {
  kind: StorageKind;
  userId: string;
  /** Sanitized base name (no path); an extension is recommended. */
  fileName: string;
  mimeType: string;
}

/** Store a buffer; returns the storage key to persist on the document. */
export async function putFile(buffer: Buffer, opts: PutOptions): Promise<string> {
  const safeName = sanitizeFileName(opts.fileName);

  if (isImageKitEnabled()) {
    let res;
    try {
      res = await getIk().files.upload({
        file: await toFile(buffer, safeName, { type: opts.mimeType }),
        fileName: safeName,
        folder: `${env.IMAGEKIT_FOLDER}/${opts.kind}/${opts.userId}`,
        isPrivateFile: true,
        useUniqueFileName: true,
      });
    } catch (err) {
      const e = toUnavailable('upload', err);
      logger.error({ err: e, hint: imageKitHint(e.status) }, 'storage: ImageKit upload failed');
      throw e;
    }
    if (!res.fileId || !res.filePath) throw new Error('ImageKit upload returned no fileId/filePath');
    return `${IK_PREFIX}${res.fileId}${res.filePath}`;
  }

  const dir = path.join(LOCAL_ROOT, opts.kind);
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`);
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

/* Tiny read-through cache: keys are immutable (unique names), and the same
 * resume is attached to every send in a batch — avoid re-downloading it. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 16;
const cache = new Map<string, { buf: Buffer; at: number }>();

function cacheGet(key: string): Buffer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.buf;
}

function cacheSet(key: string, buf: Buffer): void {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { buf, at: Date.now() });
}

/** Read a stored file fully into memory. Throws StorageNotFoundError when absent. */
export async function getFile(key: string): Promise<Buffer> {
  if (!key) throw new StorageNotFoundError(key);

  if (isRemoteKey(key)) {
    const cached = cacheGet(key);
    if (cached) return cached;
    const url = signedUrl(key, FETCH_URL_TTL_S);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      throw toUnavailable('download', err);
    }
    if (res.status === 404) throw new StorageNotFoundError(key);
    if (!res.ok) {
      const e = new StorageUnavailableError('download', res.status, res.statusText || 'unexpected status');
      logger.error({ err: e, hint: imageKitHint(res.status) }, 'storage: ImageKit download failed');
      throw e;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    cacheSet(key, buf);
    return buf;
  }

  try {
    return await fs.promises.readFile(key);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
    throw err;
  }
}

/** Best-effort delete; never throws (a missing file is already "deleted"). */
export async function removeFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  cache.delete(key);
  try {
    if (isRemoteKey(key)) {
      await getIk().files.delete(parseIkKey(key).fileId);
    } else {
      await fs.promises.unlink(key);
    }
  } catch (err) {
    const status = (err as { status?: number }).status;
    const code = (err as NodeJS.ErrnoException).code;
    if (status !== 404 && code !== 'ENOENT') {
      logger.warn({ err, remote: isRemoteKey(key) }, 'storage: delete failed');
    }
  }
}

/**
 * Short-lived signed URL for a PRIVATE ImageKit file (remote keys only).
 * `transformation` lets image callers ask ImageKit for WebP/AVIF + resizing.
 */
export function signedUrl(
  key: string,
  expiresInSeconds: number,
  transformation?: Array<Record<string, string | number>>,
): string {
  const { filePath } = parseIkKey(key);
  return getIk().helper.buildSrc({
    urlEndpoint: urlEndpoint(),
    src: filePath,
    signed: true,
    expiresIn: expiresInSeconds,
    ...(transformation ? { transformation } : {}),
  });
}

/** Origin of the ImageKit delivery endpoint (for CSP img-src), or null when disabled. */
export function imageKitOrigin(): string | null {
  if (!env.IMAGEKIT_URL_ENDPOINT) return null;
  try {
    return new URL(env.IMAGEKIT_URL_ENDPOINT).origin;
  } catch {
    return null;
  }
}

function sanitizeFileName(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 8);
  const base = path
    .basename(name, path.extname(name))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 60);
  return `${base || 'file'}${ext}`;
}
