/**
 * Shrink a job-post screenshot in the browser before upload.
 *
 * Retina/phone screenshots are often 2–8 MB PNGs; re-encoding to WebP (JPEG
 * fallback) at ≤2000 px wide keeps text crisp for Gemini/OCR while cutting the
 * upload, server RAM, storage and bandwidth by ~5–10×. Anything unexpected
 * (no canvas, decode error, bigger result) → the original file is sent.
 */

export const SKIP_BELOW_BYTES = 800 * 1024;
export const MAX_WIDTH = 2000;
export const MAX_PIXELS = 12_000_000;
const QUALITY = 0.9;

/** Output dimensions: never upscale; cap width and total pixel count. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  let scale = Math.min(1, MAX_WIDTH / width);
  const pixels = width * height * scale * scale;
  if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

function renamed(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'screenshot';
  return `${base}.${ext}`;
}

export async function compressScreenshot(file: File): Promise<File> {
  if (file.size < SKIP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Safari < 17 silently falls back to PNG for unsupported types — check the result type.
    let blob = await toBlob(canvas, 'image/webp');
    let ext = 'webp';
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg');
      ext = 'jpg';
    }
    if (!blob || !blob.type.startsWith('image/') || blob.size >= file.size * 0.9) return file;
    return new File([blob], renamed(file.name, ext), { type: blob.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
