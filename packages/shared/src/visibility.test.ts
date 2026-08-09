import { describe, expect, it } from 'vitest';

import { intersectVisibilityEnvelopes } from '#src/visibility.js';

describe('intersectVisibilityEnvelopes', () => {
  it('keeps team evidence team-visible', () => {
    expect(intersectVisibilityEnvelopes([{ visibility: 'team' }])).toEqual({
      visibility: 'team',
      visibilityOwnerUserId: null,
      visibilityUserIds: null,
    });
  });

  it('intersects specific-user audiences deterministically', () => {
    expect(
      intersectVisibilityEnvelopes([
        { visibility: 'specific_users', visibilityUserIds: ['b', 'a'] },
        { visibility: 'specific_users', visibilityUserIds: ['c', 'b'] },
      ]),
    ).toEqual({
      visibility: 'specific_users',
      visibilityOwnerUserId: null,
      visibilityUserIds: ['b'],
    });
  });

  it('fails closed for disjoint audiences', () => {
    expect(() =>
      intersectVisibilityEnvelopes([
        { visibility: 'private', visibilityOwnerUserId: 'a' },
        { visibility: 'specific_users', visibilityUserIds: ['b'] },
      ]),
    ).toThrow('no common visible audience');
  });
});
