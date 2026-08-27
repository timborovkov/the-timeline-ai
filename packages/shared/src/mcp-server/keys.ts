import { createHash, randomBytes } from 'node:crypto';

// Phase 11 — Timeline-as-MCP-server bearer keys. The plaintext shape is
// `tla_<32 url-safe base64 bytes>` so the prefix `tla_xxxxx…` is easy to
// recognise in logs without identifying which key it is.
const PREFIX = 'tla_';

export interface MintedKey {
  /** Plaintext key shown to the user exactly once. */
  plaintext: string;
  /** Public prefix stored alongside the hash for UI display. */
  prefix: string;
  /** SHA-256 hex of the plaintext. */
  hash: string;
}

export function mintKey(): MintedKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, PREFIX.length + 8);
  return { plaintext, prefix, hash };
}

export function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
