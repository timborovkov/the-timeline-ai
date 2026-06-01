import { describe, expect, it } from 'vitest';

import { attentionCount, workAttentionCount } from '@/lib/hub-status';

describe('hub status helpers', () => {
  it('aggregates only positive attention counts', () => {
    expect(attentionCount(2, 0, -1, 3)).toBe(5);
  });

  it('deduplicates unread approval notifications from work attention', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        unreadNotifications: 5,
        unreadApprovalNotifications: 3,
        overdueTasks: 2,
      }),
    ).toBe(7);
  });

  it('never lets approval notification dedupe make unread work negative', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        unreadNotifications: 1,
        unreadApprovalNotifications: 3,
        overdueTasks: 2,
      }),
    ).toBe(5);
  });
});
