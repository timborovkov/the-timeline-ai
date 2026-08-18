import { describe, expect, it } from 'vitest';

import {
  reconciliationClusterRowHint,
  reconciliationEvidenceRowHint,
  reconciliationOutputRowHint,
} from '@/components/reconciliation/row-hint';

describe('reconciliation row hints', () => {
  it('names cluster ids and keeps raw keys off the primary line', () => {
    const hint = reconciliationClusterRowHint({
      artifactClusterKind: 'customer_project',
      artifactType: 'monday_board',
      clusterId: 'cluster-1',
      status: 'active',
      timeZone: 'UTC',
      updatedAt: new Date('2026-06-30T10:00:00.000Z'),
    });

    expect(hint).toContain('Jun 30, 2026');
    expect(hint).toContain('Cluster ID: cluster-1');
    expect(hint).toContain('customer_project · monday_board · active');
  });

  it('names output and evidence ids without dumping JSON', () => {
    const hint = reconciliationOutputRowHint({
      clusterId: 'cluster-1',
      confidence: 'high',
      createdAt: new Date('2026-06-30T10:00:00.000Z'),
      outputId: 'output-1',
      outputKind: 'agent_suggestion_projection',
      sourcePayloadRefs: ['inline://monday/pulse-123'],
      sourceRefs: [
        {
          evidenceId: 'evidence-1',
          rawEventId: 'raw-event-1',
          sourcePayloadRef: 'inline://monday/pulse-123',
        },
      ],
      status: 'approval_created',
      targetId: 'object-1',
      targetKind: 'object',
      timeZone: 'UTC',
    });

    expect(hint).toContain('Output ID: output-1');
    expect(hint).toContain('Cluster ID: cluster-1');
    expect(hint).toContain('Target ID: object-1');
    expect(hint).toContain('Raw event ID: raw-event-1');
    expect(hint).toContain('Evidence ID: evidence-1');
    expect(hint).toContain('Payload ref: inline://monday/pulse-123');
    expect(hint).not.toContain('{');
  });

  it('names evidence ids for cluster rows', () => {
    const hint = reconciliationEvidenceRowHint({
      authoritative: true,
      externalObjectId: 'pulse-123',
      rawEventId: 'raw-event-1',
      role: 'decision',
      strength: 'provider',
    });

    expect(hint).toContain('Raw event ID: raw-event-1');
    expect(hint).toContain('External object ID: pulse-123');
    expect(hint).toContain('authoritative');
  });
});
