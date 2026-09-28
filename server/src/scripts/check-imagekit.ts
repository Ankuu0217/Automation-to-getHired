/**
 * `pnpm --filter @jobmail/server imagekit:check`
 *
 * Verifies the ImageKit config in server/.env end-to-end, exactly the way the
 * app uses it: upload a PRIVATE test file → read it back through a signed URL
 * → delete it. Prints a precise fix hint on any failure. Safe to run anytime;
 * the test file lives for a second under <IMAGEKIT_FOLDER>/_healthcheck/.
 */
import zlib from 'node:zlib';
import { env } from '../config/env';
import {
  getFile,
  imageKitHint,
  isImageKitEnabled,
  putFile,
  removeFile,
  StorageUnavailableError,
} from '../services/storage';

/** A real, valid 1×1 PNG (ImageKit validates image uploads). */
function tinyPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]); // 1x1, 8-bit RGB
  const idat = zlib.deflateSync(Buffer.from([0, 0x2b, 0x8a, 0xff])); // filter 0 + one pixel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main(): Promise<void> {
  if (!isImageKitEnabled()) {
    console.log('✗ ImageKit is NOT configured — set IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT in server/.env.');
    process.exitCode = 1;
    return;
  }
  console.log(`Endpoint: ${env.IMAGEKIT_URL_ENDPOINT}  ·  folder: ${env.IMAGEKIT_FOLDER}`);
  const png = tinyPng();
  let key: string | null = null;
  try {
    key = await putFile(png, { kind: 'screenshots', userId: '_healthcheck', fileName: 'check.png', mimeType: 'image/png' });
    console.log(`✓ upload (private)       ${key}`);
    const back = await getFile(key);
    if (!back.equals(png)) throw new Error('downloaded bytes differ from the upload');
    console.log('✓ signed-URL download   bytes match');
    await removeFile(key);
    console.log('✓ delete');
    console.log('\nImageKit is configured correctly.');
  } catch (err) {
    const status = err instanceof StorageUnavailableError ? err.status : null;
    console.log(`✗ ${(err as Error).message}`);
    console.log(`  → ${err instanceof StorageUnavailableError ? imageKitHint(status) : 'Check IMAGEKIT_URL_ENDPOINT (signed URLs are built from it).'}`);
    if (key) await removeFile(key);
    process.exitCode = 1;
  }
}

void main();
