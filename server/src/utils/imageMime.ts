export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Sniff the real image type from magic bytes (SPEC §8 — never trust the
 * declared MIME or extension). Returns null for anything unrecognized.
 */
export function sniffImageMime(head: Buffer): ImageMime | null {
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 12 &&
    head.toString('ascii', 0, 4) === 'RIFF' &&
    head.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
