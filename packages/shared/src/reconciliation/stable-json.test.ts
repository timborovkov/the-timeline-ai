import { describe, expect, it } from 'vitest';

import {
  inlineSourceSnapshotMetadata,
  payloadDigestFromMetadata,
  sourcePayloadRefFromMetadata,
} from '#src/reconciliation/source-snapshot.js';
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

  it('reads source payload refs from canonical and replay-compatibility metadata keys', () => {
    expect(
      sourcePayloadRefFromMetadata({ source_payload_ref: '  s3://canonical/ref.json  ' }),
    ).toBe('s3://canonical/ref.json');
    expect(sourcePayloadRefFromMetadata({ sourcePayloadRef: 's3://camel/ref.json' })).toBe(
      's3://camel/ref.json',
    );
    expect(sourcePayloadRefFromMetadata({ payload_ref: 's3://payload/ref.json' })).toBe(
      's3://payload/ref.json',
    );
    expect(sourcePayloadRefFromMetadata({ raw_payload_ref: 's3://raw/ref.json' })).toBe(
      's3://raw/ref.json',
    );
    expect(sourcePayloadRefFromMetadata({ source_snapshot_ref: 'inline://snapshot/ref' })).toBe(
      'inline://snapshot/ref',
    );
    expect(
      sourcePayloadRefFromMetadata({ source_payload_ref: '   ', raw_payload_ref: 7 }),
    ).toBeNull();
  });

  it('reads payload digests from canonical and replay-compatibility metadata keys', () => {
    expect(payloadDigestFromMetadata({ payload_digest: '  sha256:canonical  ' })).toBe(
      'sha256:canonical',
    );
    expect(payloadDigestFromMetadata({ source_payload_digest: 'sha256:source' })).toBe(
      'sha256:source',
    );
    expect(payloadDigestFromMetadata({ raw_payload_digest: 'sha256:raw' })).toBe('sha256:raw');
    expect(
      payloadDigestFromMetadata({ payload_digest: '   ', source_payload_digest: 7 }),
    ).toBeNull();
  });
});
