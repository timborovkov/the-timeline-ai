import { describe, expect, it } from 'vitest';

import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  eventSourceLabel,
  evidenceRoleLabel,
  evidenceStrengthLabel,
  legacyProvenanceLabel,
  outputActionLabel,
  outputKindLabel,
  outputStatusLabel,
  runTriggerLabel,
} from '@/components/reconciliation/presentation';

describe('reconciliation presentation', () => {
  it('replaces storage tokens with concise operator labels', () => {
    expect(artifactClusterKindLabel('customer_project')).toBe('Customer project');
    expect(runTriggerLabel('backfill')).toBe('Repair preview');
    expect(runTriggerLabel('raw_event')).toBe('Capture');
    expect(legacyProvenanceLabel('object source_event_id')).toBe('Object source event ID');
    expect(eventSourceLabel('slack')).toBe('Slack');
    expect(eventSourceLabel('legacy_object_source_event')).toBe('Legacy object source event');
    expect(artifactTypeLabel('monday_board')).toBe('Monday board');
    expect(clusterStatusLabel('candidate')).toBe('Candidate');
    expect(evidenceRoleLabel('related_context')).toBe('Related context');
    expect(evidenceStrengthLabel('provider')).toBe('Provider evidence');
    expect(outputKindLabel('agent_suggestion_projection')).toBe('Suggestion projection');
    expect(outputActionLabel({ operation: 'update', targetKind: 'object' })).toBe(
      'Update workspace memory',
    );
    expect(confidenceLabel('high')).toBe('High confidence');
    expect(outputStatusLabel('approval_created')).toBe('Approval created');
  });

  it('keeps unfamiliar diagnostic values legible without exposing separators', () => {
    expect(outputKindLabel('provider_sync_result')).toBe('Provider sync result');
    expect(confidenceLabel('very_high')).toBe('Very high confidence');
  });
});
