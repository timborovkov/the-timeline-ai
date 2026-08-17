import { describe, expect, it } from 'vitest';

import {
  artifactClusterKindLabel,
  artifactTypeLabel,
  clusterStatusLabel,
  confidenceLabel,
  evidenceRoleLabel,
  evidenceStrengthLabel,
  outputActionLabel,
  outputKindLabel,
  outputStatusLabel,
} from '@/components/reconciliation/presentation';

describe('reconciliation presentation', () => {
  it('replaces storage tokens with concise operator labels', () => {
    expect(artifactClusterKindLabel('customer_project')).toBe('Customer project');
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
