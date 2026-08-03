import { describe, expect, it } from 'vitest';

import { notificationKindLabel } from '@/lib/notification-labels';

describe('notificationKindLabel', () => {
  it('maps notification enums to calm, human-readable labels', () => {
    expect(notificationKindLabel('agent_suggestion')).toBe('Suggestion ready');
    expect(notificationKindLabel('connection_attention')).toBe('Connection needs attention');
    expect(notificationKindLabel('follow_up_overdue')).toBe('Follow-up overdue');
  });

  it('keeps an unknown future kind readable', () => {
    expect(notificationKindLabel('future_notification')).toBe('future notification');
  });
});
