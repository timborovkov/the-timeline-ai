import { describe, expect, it } from 'vitest';

import {
  AUTHORITY_POLICY_VERSION,
  authorityDecisionPayload,
  evaluateAuthorityPolicy,
} from '#src/reconciliation/authority.js';

describe('reconciliation authority policy', () => {
  it('allows provider-owned lifecycle updates as direct writes', () => {
    const result = evaluateAuthorityPolicy({
      source: 'integration',
      provider: 'sentry',
      eventType: 'issue.resolved',
      clusterKind: 'incident',
      targetKind: 'cluster_lifecycle',
      targetField: 'status',
      externalObjectId: 'SENTRY-123',
      visibility: 'team',
      confidence: 'high',
      currentOwner: { provider: 'sentry', externalObjectId: 'SENTRY-123' },
    });

    expect(result).toEqual({
      decision: 'direct',
      outputKind: 'direct_write',
      requiresApproval: false,
      reason: 'provider_owns_external_object_state',
      policyVersion: AUTHORITY_POLICY_VERSION,
    });
  });

  it('keeps provider identity context observed-only when it does not own target state', () => {
    const result = evaluateAuthorityPolicy({
      source: 'integration',
      provider: 'monday',
      eventType: 'item.comment_created',
      clusterKind: 'customer_project',
      targetKind: 'cluster_identity',
      externalObjectId: 'item-456',
      visibility: 'team',
      confidence: 'high',
    });

    expect(result).toMatchObject({
      decision: 'observed_only',
      outputKind: 'observed_association',
      requiresApproval: false,
      reason: 'context_attached_without_canonical_state_change',
    });
  });

  it('requires approval for memory changes inferred from conversations and documents', () => {
    expect(
      evaluateAuthorityPolicy({
        source: 'email',
        eventType: 'message.received',
        clusterKind: 'account',
        targetKind: 'object_relationship',
        targetField: 'company_person',
        visibility: 'team',
        confidence: 'high',
      }),
    ).toMatchObject({
      decision: 'approval_required',
      outputKind: 'approval_bundle',
      requiresApproval: true,
      reason: 'human_approval_required_for_memory_change',
    });

    expect(
      evaluateAuthorityPolicy({
        source: 'document',
        eventType: 'document.version_finalized',
        clusterKind: 'document',
        targetKind: 'object',
        targetField: 'summary',
        visibility: 'team',
        confidence: 'medium',
      }),
    ).toMatchObject({
      decision: 'approval_required',
      outputKind: 'approval_bundle',
    });
  });

  it('blocks low-confidence or wrong-owner direct writes', () => {
    expect(
      evaluateAuthorityPolicy({
        source: 'integration',
        provider: 'github',
        eventType: 'issue.closed',
        clusterKind: 'incident',
        targetKind: 'cluster_lifecycle',
        targetField: 'status',
        externalObjectId: 'GH-1',
        visibility: 'team',
        confidence: 'low',
      }),
    ).toMatchObject({
      decision: 'blocked',
      outputKind: 'no_action',
      reason: 'low_confidence_authority_signal',
    });

    expect(
      evaluateAuthorityPolicy({
        source: 'integration',
        provider: 'github',
        eventType: 'issue.closed',
        clusterKind: 'incident',
        targetKind: 'cluster_lifecycle',
        targetField: 'status',
        externalObjectId: 'GH-1',
        visibility: 'team',
        confidence: 'high',
        currentOwner: { provider: 'sentry', externalObjectId: 'SENTRY-1' },
      }),
    ).toMatchObject({
      decision: 'blocked',
      outputKind: 'no_action',
      reason: 'provider_does_not_own_target_field',
    });
  });

  it('serializes decisions into reconciliation output authority payloads', () => {
    const input = {
      source: 'integration',
      provider: 'linear',
      eventType: 'issue.updated',
      targetKind: 'cluster_lifecycle',
      targetField: 'status',
      externalObjectId: 'LIN-1',
      visibility: 'team' as const,
      confidence: 'high' as const,
    };
    const result = evaluateAuthorityPolicy(input);

    expect(authorityDecisionPayload(result, input)).toEqual({
      decision: 'direct_write',
      authority_decision: 'direct',
      reason: 'provider_owns_external_object_state',
      source: 'integration',
      provider: 'linear',
      target_kind: 'cluster_lifecycle',
      target_field: 'status',
      policy_version: AUTHORITY_POLICY_VERSION,
    });
  });
});
