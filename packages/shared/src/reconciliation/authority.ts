import type { ArtifactClusterKind, Visibility } from '#src/reconciliation/index.js';

export const AUTHORITY_POLICY_VERSION = 'reconciliation-authority-2026-06';

export type AuthorityDecision = 'direct' | 'approval_required' | 'observed_only' | 'blocked';
export type AuthorityConfidence = 'low' | 'medium' | 'high';

export interface AuthorityPolicyInput {
  source: string;
  provider?: string | null;
  eventType: string;
  clusterKind?: ArtifactClusterKind | null;
  targetKind: string;
  targetField?: string | null;
  externalObjectId?: string | null;
  visibility: Visibility;
  confidence: AuthorityConfidence;
  currentOwner?: {
    provider?: string | null;
    externalObjectId?: string | null;
  } | null;
}

export interface AuthorityPolicyDecision {
  decision: AuthorityDecision;
  outputKind: 'direct_write' | 'approval_bundle' | 'observed_association' | 'no_action';
  requiresApproval: boolean;
  reason: string;
  policyVersion: typeof AUTHORITY_POLICY_VERSION;
}

const PROVIDER_SOURCES = new Set(['integration', 'calendar']);
const PROVIDER_CLUSTER_LIFECYCLE = new Set(['github', 'linear', 'sentry', 'monday', 'calendar']);
const PROVIDER_BOARD_ITEM_FIELDS = new Set([
  'laneId',
  'status',
  'owner',
  'responsibleUserId',
  'dueAt',
  'priority',
  'position',
  'customFields',
]);
const PROVIDER_CALENDAR_FIELDS = new Set([
  'startAt',
  'endAt',
  'timezone',
  'location',
  'status',
  'rrule',
  'showAs',
]);
const CONVERSATIONAL_SOURCES = new Set(['email', 'slack', 'telegram', 'web', 'voice', 'meeting']);
const DOCUMENT_SOURCES = new Set(['document', 'documents', 'drive', 'google_drive']);

export function evaluateAuthorityPolicy(input: AuthorityPolicyInput): AuthorityPolicyDecision {
  const provider = normalized(input.provider ?? providerFromSource(input.source));
  const source = normalized(input.source);
  const targetField = input.targetField ?? null;

  if (input.confidence === 'low') {
    return decision('blocked', 'no_action', false, 'low_confidence_authority_signal');
  }

  if (input.visibility !== 'team' && input.targetKind.startsWith('team_')) {
    return decision(
      'blocked',
      'no_action',
      false,
      'private_or_limited_evidence_cannot_write_team_target',
    );
  }

  if (targetField && input.currentOwner?.provider && provider !== input.currentOwner.provider) {
    return decision('blocked', 'no_action', false, 'provider_does_not_own_target_field');
  }

  if (source === 'calendar' && input.targetKind === 'calendar_event') {
    if (!targetField || PROVIDER_CALENDAR_FIELDS.has(targetField)) {
      return decision('direct', 'direct_write', false, 'calendar_provider_owns_schedule_state');
    }
  }

  if (PROVIDER_SOURCES.has(source) && provider) {
    if (
      input.targetKind === 'cluster_lifecycle' &&
      PROVIDER_CLUSTER_LIFECYCLE.has(provider) &&
      providerOwnsLifecycleEvent(provider, input.eventType) &&
      input.externalObjectId
    ) {
      return decision('direct', 'direct_write', false, 'provider_owns_external_object_state');
    }

    if (
      provider === 'monday' &&
      input.targetKind === 'board_item_update' &&
      (!targetField || PROVIDER_BOARD_ITEM_FIELDS.has(targetField)) &&
      input.externalObjectId
    ) {
      return decision('direct', 'direct_write', false, 'provider_owns_board_item_field');
    }

    if (input.targetKind === 'cluster_identity' && input.externalObjectId) {
      return decision(
        'observed_only',
        'observed_association',
        false,
        'context_attached_without_canonical_state_change',
      );
    }
  }

  if (CONVERSATIONAL_SOURCES.has(source) || DOCUMENT_SOURCES.has(source)) {
    if (input.targetKind === 'cluster_identity') {
      return decision(
        'observed_only',
        'observed_association',
        false,
        'source_can_anchor_but_not_write_memory',
      );
    }
    return decision(
      'approval_required',
      'approval_bundle',
      true,
      'human_approval_required_for_memory_change',
    );
  }

  if (input.targetKind === 'cluster_identity') {
    return decision(
      'observed_only',
      'observed_association',
      false,
      'unowned_identity_signal_is_evidence_only',
    );
  }

  return decision('approval_required', 'approval_bundle', true, 'source_has_no_direct_authority');
}

export function authorityDecisionPayload(
  result: AuthorityPolicyDecision,
  input: AuthorityPolicyInput,
): Record<string, unknown> {
  return {
    decision: result.outputKind,
    authority_decision: result.decision,
    reason: result.reason,
    source: input.source,
    provider: input.provider ?? null,
    target_kind: input.targetKind,
    target_field: input.targetField ?? null,
    policy_version: result.policyVersion,
  };
}

function decision(
  authorityDecision: AuthorityDecision,
  outputKind: AuthorityPolicyDecision['outputKind'],
  requiresApproval: boolean,
  reason: string,
): AuthorityPolicyDecision {
  return {
    decision: authorityDecision,
    outputKind,
    requiresApproval,
    reason,
    policyVersion: AUTHORITY_POLICY_VERSION,
  };
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function providerFromSource(source: string): string | null {
  const normalizedSource = normalized(source);
  if (PROVIDER_CLUSTER_LIFECYCLE.has(normalizedSource)) return normalizedSource;
  return null;
}

function providerOwnsLifecycleEvent(provider: string, eventType: string): boolean {
  const type = normalized(eventType);
  if (provider === 'github') {
    return [
      'issue.closed',
      'issue.updated',
      'pr.merged',
      'pr.closed',
      'pr.updated',
      'release.published',
    ].includes(type);
  }
  if (provider === 'sentry' || provider === 'linear') return type.startsWith('issue.');
  if (provider === 'monday') return type.includes('status') || type.includes('completed');
  if (provider === 'calendar') {
    return type.includes('created') || type.includes('updated') || type.includes('cancelled');
  }
  return false;
}
