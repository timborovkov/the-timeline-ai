import { describe, expect, it } from 'vitest';

import { auditTargetPresentation, canSeeAuditTarget } from '#src/audit/scope.js';

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

  it('redacts restricted targets from owners omitted from the allowlist', () => {
    expect(
      canSeeAuditTarget('owner', {
        targetVisibility: 'specific_users',
        targetOwnerUserId: 'owner',
        targetVisibilityUserIds: ['viewer'],
      }),
    ).toBe(false);
  });
});

describe('auditTargetPresentation', () => {
  it('marks missing visible hydrated targets as unavailable without redacting', () => {
    expect(
      auditTargetPresentation({
        targetType: 'document',
        targetId: 'doc-1',
        visible: true,
      }),
    ).toEqual({ targetLabel: 'Unavailable document', redacted: false });
  });

  it('labels deleted team-visible integrations without a redacted badge', () => {
    expect(
      auditTargetPresentation({
        targetType: 'integration',
        targetId: 'integration-1',
        visible: true,
      }),
    ).toEqual({ targetLabel: 'Deleted integration', redacted: false });
  });

  it('keeps generic labels for target types without hydration', () => {
    expect(
      auditTargetPresentation({
        targetType: 'mcp_outbound_key',
        targetId: 'key-1',
        visible: true,
      }),
    ).toEqual({ targetLabel: 'mcp outbound key', redacted: false });
  });
});
