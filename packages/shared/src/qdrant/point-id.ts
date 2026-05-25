import { createHash } from 'node:crypto';

/**
 * Deterministic Qdrant point id derived from (scope, sourceId, modelTag).
 *
 * Qdrant accepts UUID or unsigned-int point ids. We emit UUIDs so the same
 * physical row produces the same point id every time — re-running an embed
 * job is a no-op upsert, and re-embed runs against a new model land at a
 * different id (so old + new vectors can coexist in the same collection
 * during a cutover, even before the recommended new-collection migration).
 *
 * The hash includes the model tag deliberately: changing the embedding model
 * is exactly the case where we MUST NOT overwrite a vector in place.
 */
export type PointScope =
  | 'event'
  | 'fact'
  | 'object'
  | 'object_note'
  | 'object_change'
  | 'entity'
  // Phase 9: documents are chunked and each chunk gets its own point so
  // retrieval is granular. Uses snake_case to match #22's enum convention.
  | 'doc_chunk';

export function buildPointId(scope: PointScope, sourceId: string, modelTag: string): string {
  const input = `${scope}:${sourceId}:${modelTag}`;
  const hash = createHash('sha256').update(input).digest();
  // Slice to 16 bytes and format as a UUID v4-ish string (variant bits set).
  // Qdrant validates the UUID shape but does not require an actual v4.
  const bytes = Buffer.from(hash.subarray(0, 16));
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40; // version 4
  bytes[8] = (b8 & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}
