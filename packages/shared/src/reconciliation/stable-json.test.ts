import { describe, expect, it } from 'vitest';

import { inlineSourceSnapshotMetadata } from '#src/reconciliation/source-snapshot.js';
import { stableSha256Digest } from '#src/reconciliation/stable-digest.js';
import { stableJson } from '#src/reconciliation/stable-json.js';

describe('stable reconciliation JSON helpers', () => {
  it('serializes nested objects deterministically while omitting undefined fields', () => {
    const left = {
      z: [3, { b: true, a: new Date('2026-07-02T10:00:00.000Z') }],
      omitted: undefined,
      a: null,
      m: {
        y: 'yes',
        x: 1,
        alsoOmitted: undefined,
      },
    };
    const right = {
      m: {
        x: 1,
        alsoOmitted: undefined,
        y: 'yes',
      },
      a: null,
      z: [3, { a: new Date('2026-07-02T10:00:00.000Z'), b: true }],
      omitted: undefined,
    };

    expect(stableJson(left)).toBe(
      '{"a":null,"m":{"x":1,"y":"yes"},"z":[3,{"a":"2026-07-02T10:00:00.000Z","b":true}]}',
    );
    expect(stableJson(right)).toBe(stableJson(left));
    expect(stableSha256Digest(right)).toBe(stableSha256Digest(left));
  });

  it('builds the canonical inline source snapshot metadata envelope', () => {
    const snapshot = {
      provider: 'postmark',
      message_id: '<stable@example.test>',
      nested: { b: 2, a: 1, omitted: undefined },
    };
    const digest = stableSha256Digest(snapshot);

    expect(
      inlineSourceSnapshotMetadata({
        snapshot,
        kind: 'postmark_inbound_email',
        version: 'email-source-snapshot-test',
        ref: (value) => `inline://timeline/email/${value.slice('sha256:'.length)}`,
      }),
    ).toEqual({
      source_payload_ref: `inline://timeline/email/${digest.slice('sha256:'.length)}`,
      payload_digest: digest,
      source_snapshot: snapshot,
      source_snapshot_kind: 'postmark_inbound_email',
      source_snapshot_version: 'email-source-snapshot-test',
    });
  });
});
