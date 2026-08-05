import { createWorker } from 'tesseract.js';

/**
 * OCR fallback (SPEC §2): plain tesseract.js text recognition. Only used
 * when no vision API key is configured or the vision call fails.
 */
export async function ocrImage(buffer: Buffer): Promise<string> {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(buffer);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
