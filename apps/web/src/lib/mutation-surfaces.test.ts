import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { mutationSurfaces } from '@/lib/mutation-surfaces';

describe('mutation refresh dependencies', () => {
  it('refreshes board layouts and every changed detail after an object merge', () => {
    const surfaces = mutationSurfaces({
      kind: 'objects-merged',
      survivorId: 'survivor',
      mergedIds: ['former'],
    });
    expect(surfaces).toContainEqual({ path: '/app/boards', type: 'layout' });
    expect(surfaces).toContainEqual({ path: '/app/objects/survivor' });
    expect(surfaces).toContainEqual({ path: '/app/objects/former' });
    expect(surfaces).not.toContainEqual({ path: '/app', type: 'layout' });
  });

  it('keeps a pin refresh tied to the target without invalidating unrelated domains', () => {
    const surfaces = mutationSurfaces({
      kind: 'pins-changed',
      target: { kind: 'document', key: 'doc' },
    });
    expect(surfaces).toContainEqual({ path: '/app/documents/doc' });
    expect(surfaces).toContainEqual({ path: '/app/documents' });
    expect(
      surfaces.some(
        ({ path }) => path.startsWith('/app/objects') || path.startsWith('/app/meetings'),
      ),
    ).toBe(false);
  });

  it('refreshes captured-file and timeline surfaces only when the document operation affects them', () => {
    const rename = mutationSurfaces({ kind: 'documents-changed', id: 'doc' });
    const promote = mutationSurfaces({
      kind: 'documents-changed',
      id: 'doc',
      captured: true,
      timeline: true,
    });
    expect(rename).not.toContainEqual({ path: '/app/timeline' });
    expect(rename).not.toContainEqual({ path: '/app/documents/captured' });
    expect(promote).toContainEqual({ path: '/app/timeline' });
    expect(promote).toContainEqual({ path: '/app/documents/captured' });
  });
});
