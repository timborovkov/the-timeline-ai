import { describe, expect, it } from 'vitest';

import {
  FEATURE_FLAGS,
  PRODUCT_EVENT_METADATA,
  type ProductEventPayloads,
} from '#src/analytics/events.js';

describe('product analytics contract', () => {
  it('documents every event as no-PII', () => {
    expect(Object.keys(PRODUCT_EVENT_METADATA).sort()).toEqual(
      [
        'agent_answer_generated',
        'capture_created',
        'chat_message_sent',
        'document_uploaded',
        'integration_connected',
        'invite_accepted',
        'meeting_bot_scheduled',
        'meeting_finalized',
        'object_created',
        'onboarding_step_completed',
        'team_created',
        'team_export_requested',
      ].sort(),
    );
  });

  it('keeps feature flags owned and scheduled for cleanup', () => {
    expect(FEATURE_FLAGS.onboardingChecklistV2.owner).toBe('product');
    expect(FEATURE_FLAGS.onboardingChecklistV2.cleanup.includes('Remove')).toBe(true);
  });

  it('rejects raw content fields at compile time', () => {
    const valid: ProductEventPayloads['capture_created'] = {
      teamId: 'team-id',
      userId: 'user-id',
      rawEventId: 'event-id',
      captureType: 'text',
      visibility: 'team',
    };
    expect(valid.captureType).toBe('text');

    function acceptCapturePayload(payload: ProductEventPayloads['capture_created']): string {
      return payload.captureType;
    }

    acceptCapturePayload({
      teamId: 'team-id',
      userId: 'user-id',
      rawEventId: 'event-id',
      captureType: 'text',
      visibility: 'team',
      // @ts-expect-error Raw product content is not allowed in analytics payloads.
      text: 'raw note content',
    });
  });
});
