import { describe, expect, it } from 'vitest';

import type { SuggestionBundle } from '@timeline/shared/suggestions';

import { serializeSuggestionBundle } from '@/lib/suggestions';

describe('serializeSuggestionBundle', () => {
  it('preserves approval evidence source-ref metadata for client provenance', () => {
    const rawEventId = '11111111-1111-4111-8111-111111111111';
    const bundle: SuggestionBundle = {
      id: 'bundle-1',
      source: 'background',
      status: 'pending',
      title: 'Create Acme implementation task',
      summary: 'A reconciliation output proposed a task.',
      reason: 'Source-backed approval projection',
      confidence: 'high',
      visibility: 'team',
      visibilityOwnerUserId: null,
      visibilityUserIds: null,
      metadata: { reconciliation_output_ids: ['output-1'] },
      createdAt: new Date('2026-06-20T10:00:00.000Z'),
      updatedAt: new Date('2026-06-20T10:05:00.000Z'),
      items: [
        {
          id: 'item-1',
          status: 'pending',
          operation: 'create',
          targetKind: 'task',
          targetId: null,
          resultId: null,
          title: 'Create Acme implementation task',
          description: null,
          proposedPayload: { canonicalName: 'Create Acme implementation task' },
          metadata: { reconciliation_output_id: 'output-1' },
          failureReason: null,
          supersededByItemId: null,
          supersededReason: null,
        },
      ],
      evidence: [
        {
          id: 'suggestion-evidence-1',
          rawEventId,
          quote: 'Nora approved creating the task.',
          source: 'telegram',
          occurredAt: new Date('2026-06-20T09:55:00.000Z'),
          metadata: {
            reconciliation_source_ref: {
              source: 'telegram',
              rawEventId,
              evidenceId: 'evidence-1',
              sourcePayloadRef: 's3://eval/reconciliation/telegram/message-1',
            },
            reconciliation_source_payload_ref: 's3://eval/reconciliation/telegram/message-1',
          },
        },
      ],
    };

    expect(serializeSuggestionBundle(bundle).evidence).toEqual([
      {
        rawEventId,
        quote: 'Nora approved creating the task.',
        source: 'telegram',
        occurredAt: '2026-06-20T09:55:00.000Z',
        metadata: {
          reconciliation_source_ref: {
            source: 'telegram',
            rawEventId,
            evidenceId: 'evidence-1',
            sourcePayloadRef: 's3://eval/reconciliation/telegram/message-1',
          },
          reconciliation_source_payload_ref: 's3://eval/reconciliation/telegram/message-1',
        },
      },
    ]);
  });
});
