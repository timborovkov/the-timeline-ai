import { randomBytes } from 'node:crypto';

import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  resetSecretsKeyCacheForTests,
} from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
describe('crypto/secrets', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });

  it('roundtrips arbitrary strings', () => {
    const plain = 'ghp_supersecrettoken_abc123';
    const enc = encryptSecret(plain);
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.iv.length).toBe(12);
    expect(enc.tag.length).toBe(16);
    expect(decryptSecret(enc).toString('utf8')).toBe(plain);
  });

  it('roundtrips JSON', () => {
    const value = { access: 'a', refresh: 'r', expires: 1234567890 };
    const enc = encryptJson(value);
    expect(decryptJson(enc)).toEqual(value);
  });

  it('produces a fresh IV per call (no key/IV reuse)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects tampered ciphertext (GCM tag mismatch)', () => {
    const enc = encryptSecret('payload');
    const ciphertext = Buffer.from(enc.ciphertext);
    // XOR rather than overwrite with a constant: setting the last byte to
    // 0xff is a no-op whenever encryption already produced 0xff there.
    ciphertext[ciphertext.length - 1] = (ciphertext[ciphertext.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptSecret({ ciphertext, iv: enc.iv, tag: enc.tag })).toThrow();
  });

  it('rejects tampered tag', () => {
    const enc = encryptSecret('payload');
    const tag = Buffer.from(enc.tag);
    tag[0] = (tag[0] ?? 0) ^ 0x01;
    expect(() => decryptSecret({ ciphertext: enc.ciphertext, iv: enc.iv, tag })).toThrow();
  });

  it('rejects wrong IV length', () => {
    const enc = encryptSecret('payload');
    expect(() =>
      decryptSecret({ ciphertext: enc.ciphertext, iv: Buffer.alloc(8), tag: enc.tag }),
    ).toThrow(/Invalid IV length/);
  });

  it('throws a useful error when env key is missing', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    expect(() => encryptSecret('x')).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });

  it('rejects a key with the wrong byte length', () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });
});
