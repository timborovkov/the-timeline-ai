import { describe, expect, it } from 'vitest';

import {
  attentionCount,
  countDismissibleMeetingFailures,
  workAttentionCount,
} from '@/lib/hub-status';

describe('hub status helpers', () => {
  it('aggregates only positive attention counts', () => {
    expect(attentionCount(2, 0, -1, 3)).toBe(5);
  });

  it('keeps inbox notifications out of work attention', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        overdueTasks: 2,
      }),
    ).toBe(5);
  });

  it('ignores negative work attention inputs', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        overdueTasks: -2,
      }),
    ).toBe(3);
  });

  it('counts only failed meeting recovery jobs as dismissible meeting attention', () => {
    expect(
      countDismissibleMeetingFailures([
        { kind: 'meeting_finalization', status: 'failed' },
        { kind: 'meeting_finalization', status: 'stuck' },
        { kind: 'embedding', status: 'failed' },
      ] as Parameters<typeof countDismissibleMeetingFailures>[0]),
    ).toBe(1);
  });
});
