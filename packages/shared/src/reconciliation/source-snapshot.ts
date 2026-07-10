import { stableSha256Digest } from '#src/reconciliation/stable-digest.js';

export interface InlineSourceSnapshotMetadataInput {
  snapshot: Record<string, unknown>;
  kind: string;
  version: string;
  ref: (digest: string) => string;
}

export function inlineSourceSnapshotMetadata(
  input: InlineSourceSnapshotMetadataInput,
): Record<string, unknown> {
  const digest = stableSha256Digest(input.snapshot);
  return {
    source_payload_ref: input.ref(digest),
    payload_digest: digest,
    source_snapshot: input.snapshot,
    source_snapshot_kind: input.kind,
    source_snapshot_version: input.version,
  };
}

export function sourcePayloadRefFromMetadata(metadata: unknown): string | null {
  const record = recordFromUnknown(metadata);
  return firstString(
    record.source_payload_ref,
    record.sourcePayloadRef,
    record.payload_ref,
    record.raw_payload_ref,
    record.source_snapshot_ref,
  );
}

export function payloadDigestFromMetadata(metadata: unknown): string | null {
  const record = recordFromUnknown(metadata);
  return firstString(
    record.payload_digest,
    record.source_payload_digest,
    record.raw_payload_digest,
  );
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
