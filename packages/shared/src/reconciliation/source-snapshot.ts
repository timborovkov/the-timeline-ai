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
