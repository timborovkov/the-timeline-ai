import { createHash } from 'node:crypto';

/**
 * Stable digest for one metered model call. Length-prefixed parts keep
 * `['ab','c']` distinct from `['a','bc']`.
 */
function hashAiCallMaterial(parts: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(String(parts.length));
  for (const part of parts) {
    hash.update('\0');
    hash.update(String(part.length));
    hash.update('\0');
    hash.update(part);
  }
  return hash.digest('hex');
}

export function digestAiBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Cache key for one model call inside a worker job. A retry of the same
 * stage and input reuses the settlement. A different prompt, schema, model,
 * or input gets a different id, so it cannot replay the earlier result.
 */
export function scopedAiOperationId(input: {
  parentOperationId: string;
  stage: string;
  material: readonly string[];
}): string {
  const stage = input.stage.trim();
  if (stage.length === 0) {
    throw new Error('AI metering stage is required');
  }
  if (input.material.length === 0) {
    throw new Error('AI metering callMaterial is required');
  }
  return `${input.parentOperationId}:${stage}:${hashAiCallMaterial([stage, ...input.material])}`;
}
