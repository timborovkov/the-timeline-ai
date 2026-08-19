import { describe, expect, it } from 'vitest';

import { notificationHref } from '@/lib/notification-href';

describe('notificationHref', () => {
  it('deep-links mention notifications into the object discussion comment', () => {
    expect(
      notificationHref({
        kind: 'mention',
        entityId: '11111111-1111-1111-1111-111111111111',
        payload: { note_id: '22222222-2222-2222-2222-222222222222' },
      }),
    ).toBe(
      '/app/objects/11111111-1111-1111-1111-111111111111?comment=22222222-2222-2222-2222-222222222222#comment-22222222-2222-2222-2222-222222222222',
    );
  });

  it('falls back to the object page when a mention has no comment id', () => {
    expect(
      notificationHref({
        kind: 'mention',
        entityId: '11111111-1111-1111-1111-111111111111',
        payload: {},
      }),
    ).toBe('/app/objects/11111111-1111-1111-1111-111111111111');
  });
});
