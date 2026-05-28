import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { getEnv } from '#src/env.js';

// AES-256-GCM secret helper used by Phase 11 integrations. Every refresh
// token, bearer token, header value, and MCP auth blob is encrypted at
// rest with a single env-supplied key. The DB persists three columns per
// secret: `*_ciphertext`, `*_iv`, `*_tag`. Read paths call
// `decryptSecret({ ciphertext, iv, tag })`; the tag check rejects any
// tampering before the plaintext is returned.
//
// Key format: `SECRETS_ENCRYPTION_KEY` is a 32-byte AES-256 key,
// base64-encoded (44 chars with padding). Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

let _keyCache: Buffer | undefined;

function resolveKey(): Buffer {
  if (_keyCache) return _keyCache;
  const raw = getEnv().SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is required to encrypt/decrypt integration secrets. ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_ENCRYPTION_KEY must decode to ${String(KEY_BYTES)} bytes (got ${String(key.length)}). ` +
        'Use a base64-encoded 32-byte key.',
    );
  }
  _keyCache = key;
  return key;
}

/** Test-only: clear the resolved-key cache. */
export function resetSecretsKeyCacheForTests(): void {
  _keyCache = undefined;
}

export function encryptSecret(plain: Buffer | string): EncryptedSecret {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plainBuf = typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain;
  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Unexpected GCM tag length ${String(tag.length)}`);
  }
  return { ciphertext, iv, tag };
}

export function decryptSecret(secret: EncryptedSecret): Buffer {
  const key = resolveKey();
  if (secret.iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length ${String(secret.iv.length)}`);
  }
  if (secret.tag.length !== TAG_BYTES) {
    throw new Error(`Invalid tag length ${String(secret.tag.length)}`);
  }
  const decipher = createDecipheriv('aes-256-gcm', key, secret.iv);
  decipher.setAuthTag(secret.tag);
  // `final()` throws on tag mismatch — that's our integrity check.
  return Buffer.concat([decipher.update(secret.ciphertext), decipher.final()]);
}

export function encryptJson(value: unknown): EncryptedSecret {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson(secret: EncryptedSecret): unknown {
  const buf = decryptSecret(secret);
  return JSON.parse(buf.toString('utf8'));
}
