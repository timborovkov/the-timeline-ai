import { createHash } from 'node:crypto';

import { stableJson } from '#src/reconciliation/stable-json.js';

export function stableSha256Digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}
