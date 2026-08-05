import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, sha256 } from '../src/utils/crypto';

describe('crypto utils (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const secret = 'ya29.fake-gmail-access-token-12345';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('handles unicode and long payloads', () => {
    const secret = 'token-with-üñïçødé — '.repeat(200);
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('produces unique ciphertexts for identical input (random IV)', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const payload = Buffer.from(encrypt('sensitive'), 'base64');
    payload[payload.length - 1] ^= 0xff;
    expect(() => decrypt(payload.toString('base64'))).toThrow();
  });

  it('rejects garbage input', () => {
    expect(() => decrypt('not-valid')).toThrow();
  });

  it('sha256 is deterministic and hex', () => {
    const h = sha256('user1|hr@acme.com|Acme|Engineer');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('user1|hr@acme.com|Acme|Engineer')).toBe(h);
    expect(sha256('different')).not.toBe(h);
  });
});
