import { describe, expect, it } from 'vitest';

import { buildPointId } from './point-id.js';

const UUID_V4_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildPointId', () => {
  it('produces a UUID-v4-shaped id', () => {
    const id = buildPointId('event', 'src-1', 'model-x');
    expect(id).toMatch(UUID_V4_LIKE);
  });

  it('is deterministic in (scope, sourceId, modelTag)', () => {
    const a = buildPointId('event', 'src-1', 'model-x');
    const b = buildPointId('event', 'src-1', 'model-x');
    expect(a).toBe(b);
  });

  it('changes id when the embedding model changes (no in-place overwrite)', () => {
    // Critical idempotency property: re-embedding with a new model writes
    // a different point so old vectors aren't clobbered during cutover.
    const a = buildPointId('fact', 'fact-1', 'openai/text-embedding-3-small');
    const b = buildPointId('fact', 'fact-1', 'openai/text-embedding-3-large');
    expect(a).not.toBe(b);
  });

  it('Phase 9 — doc-chunk scope produces ids distinct from event/fact', () => {
    // A chunk id that happens to match an event id MUST NOT collide on
    // the same model. The scope discriminator in the hash input is the
    // sole separator.
    const sameSourceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const evId = buildPointId('event', sameSourceId, 'm');
    const factId = buildPointId('fact', sameSourceId, 'm');
    const docId = buildPointId('doc-chunk', sameSourceId, 'm');
    expect(new Set([evId, factId, docId]).size).toBe(3);
    expect(docId).toMatch(UUID_V4_LIKE);
  });
});
