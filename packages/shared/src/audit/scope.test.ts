import { describe, expect, it } from 'vitest';

import { canSeeAuditTarget } from './scope.js';

describe('canSeeAuditTarget', () => {
  it('allows team-visible targets', () => {
    expect(
      canSeeAuditTarget('viewer', {
        targetVisibility: 'team',
        targetOwnerUserId: null,
        targetVisibilityUserIds: null,
      }),
    ).toBe(true);
  });

  it('redacts private targets from non-owners', () => {
    expect(
      canSeeAuditTarget('viewer', {
        targetVisibility: 'private',
        targetOwnerUserId: 'owner',
        targetVisibilityUserIds: null,
      }),
    ).toBe(false);
  });

  it('allows restricted targets only for listed viewers', () => {
    expect(
      canSeeAuditTarget('viewer', {
        targetVisibility: 'specific_users',
        targetOwnerUserId: null,
        targetVisibilityUserIds: ['viewer'],
      }),
    ).toBe(true);
    expect(
      canSeeAuditTarget('other', {
        targetVisibility: 'specific_users',
        targetOwnerUserId: null,
        targetVisibilityUserIds: ['viewer'],
      }),
    ).toBe(false);
  });
});
