import { describe, expect, it } from 'vitest';

import {
  APP_ANALYTICS_SURFACES,
  PRODUCT_EVENT_METADATA,
  PUBLIC_ANALYTICS_SURFACES,
  bucketAnalyticsCount,
  bucketCaptureDuration,
  bucketDocumentSize,
  bucketMeetingDuration,
  bucketSearchResultCount,
  classifyDocumentContentType,
  validateAnalyticsActor,
  validatePersonlessSurface,
  validateProductEventProperties,
  type ProductEventPayloads,
} from '#src/analytics/events.js';

describe('product analytics contract', () => {
  it('documents every event as pseudonymous with an explicit purpose and retention target', () => {
    expect(Object.keys(PRODUCT_EVENT_METADATA).sort()).toEqual(
      [
        'account_registered',
        'approval_decision_submitted',
        'agent_answer_generated',
        'authentication_succeeded',
        'board_action_completed',
        'calendar_action_completed',
        'capture_created',
        'chat_message_sent',
        'document_action_completed',
        'document_uploaded',
        'integration_connected',
        'integration_management_action_completed',
        'invite_accepted',
        'meeting_bot_scheduled',
        'meeting_finalized',
        'object_action_completed',
        'object_created',
        'onboarding_step_completed',
        'search_performed',
        'task_category_changed',
        'task_project_changed',
        'team_created',
        'team_export_requested',
        'team_management_action_completed',
      ].sort(),
    );
    for (const entry of Object.values(PRODUCT_EVENT_METADATA)) {
      expect(entry).toMatchObject({
        dataClass: 'pseudonymous_product_usage',
        retention: '90_days_target_provider_setting_unverified',
      });
      expect(entry.purpose).not.toHaveLength(0);
    }
  });

  it('rejects unknown properties and raw identifiers at runtime', () => {
    expect(() =>
      validateProductEventProperties('capture_created', {
        captureType: 'text',
        visibility: 'team',
        rawEventId: 'raw-event-1',
      }),
    ).toThrow();

    expect(() =>
      validateProductEventProperties('document_uploaded', {
        sizeBucket: 'under_1mb',
        contentType: 'pdf',
        visibility: 'private',
        filename: 'secret.pdf',
      }),
    ).toThrow();
  });

  it('rejects arbitrary attribution content even when it is short and regex-safe', () => {
    expect(() =>
      validateProductEventProperties('account_registered', {
        source: 'credentials',
        joinedViaInvite: false,
        attributionCampaign: 'John Doe private project',
      }),
    ).toThrow();
  });

  it('rejects raw content fields at compile time', () => {
    const valid: ProductEventPayloads['capture_created'] = {
      captureType: 'text',
      visibility: 'team',
    };
    expect(valid.captureType).toBe('text');

    function acceptCapturePayload(payload: ProductEventPayloads['capture_created']): string {
      return payload.captureType;
    }

    acceptCapturePayload({
      captureType: 'text',
      visibility: 'team',
      // @ts-expect-error Raw product content is not allowed in analytics payloads.
      text: 'raw note content',
    });
  });

  it('strictly validates actors without including them in event properties', () => {
    expect(validateAnalyticsActor({ kind: 'user', userId: 'user-1', teamId: 'team-1' })).toEqual({
      kind: 'user',
      userId: 'user-1',
      teamId: 'team-1',
    });
    expect(() =>
      validateAnalyticsActor({ kind: 'team', teamId: 'team-1', name: 'Secret team' }),
    ).toThrow();
  });

  it('fails closed for unknown public and app surfaces', () => {
    expect(validatePersonlessSurface('public', 'home')).toBe('home');
    expect(validatePersonlessSurface('app', 'board_detail')).toBe('board_detail');
    expect(() => validatePersonlessSurface('public', '/help/private-token')).toThrow();
    expect(() => validatePersonlessSurface('app', 'unknown')).toThrow();
    expect(PUBLIC_ANALYTICS_SURFACES).not.toContain('support');
    expect(APP_ANALYTICS_SURFACES).not.toContain('unknown');
  });

  it('coarsens document and meeting dimensions before export', () => {
    expect(bucketDocumentSize(999_999)).toBe('under_1mb');
    expect(bucketDocumentSize(1_000_000)).toBe('1mb_to_10mb');
    expect(bucketDocumentSize(50_000_000)).toBe('50mb_plus');
    expect(classifyDocumentContentType('application/pdf; charset=binary')).toBe('pdf');
    expect(classifyDocumentContentType('application/x-customer-secret')).toBe('other');
    expect(bucketMeetingDuration(14)).toBe('under_15m');
    expect(bucketMeetingDuration(60)).toBe('60m_plus');
    expect(bucketCaptureDuration(59)).toBe('under_1m');
    expect(bucketCaptureDuration(60)).toBe('1m_to_5m');
    expect(bucketCaptureDuration(300)).toBe('5m_to_15m');
    expect(bucketCaptureDuration(900)).toBe('15m_plus');
    expect(bucketAnalyticsCount(0)).toBe('zero');
    expect(bucketAnalyticsCount(1)).toBe('one');
    expect(bucketAnalyticsCount(2)).toBe('two_to_five');
    expect(bucketAnalyticsCount(6)).toBe('six_to_twenty');
    expect(bucketAnalyticsCount(21)).toBe('twenty_one_plus');
    expect(bucketSearchResultCount(0)).toBe('zero');
    expect(bucketSearchResultCount(10)).toBe('one_to_ten');
    expect(bucketSearchResultCount(51)).toBe('fifty_one_plus');
  });

  it('runtime-validates grouped action events without accepting resource identifiers', () => {
    expect(
      validateProductEventProperties('integration_management_action_completed', {
        action: 'mcp_key_mint',
        kind: 'mcp_outbound',
      }),
    ).toEqual({ action: 'mcp_key_mint', kind: 'mcp_outbound' });
    expect(() =>
      validateProductEventProperties('board_action_completed', {
        action: 'create',
        boardId: 'raw-board-id',
      }),
    ).toThrow();
    expect(() =>
      validateProductEventProperties('search_performed', {
        surface: 'global',
        hasFilters: false,
        resultCountBucket: 'zero',
        query: 'private search text',
      }),
    ).toThrow();
  });
});
