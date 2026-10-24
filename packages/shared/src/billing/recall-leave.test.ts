import { describe, expect, it } from 'vitest';

import { recallLeaveAnchorAt } from '#src/billing/recall-leave.js';

describe('recallLeaveAnchorAt', () => {
  it('prefers the join stamp over startedAt', () => {
    const startedAt = new Date('2026-08-01T10:00:00.000Z');
    const anchor = recallLeaveAnchorAt({
      startedAt,
      metadata: { reserved_recall_started_at: '2026-08-24T12:00:00.000Z' },
    });
    expect(anchor?.toISOString()).toBe('2026-08-24T12:00:00.000Z');
  });

  it('falls back to startedAt and never invents a createdAt clock', () => {
    const startedAt = new Date('2026-08-24T12:00:00.000Z');
    expect(recallLeaveAnchorAt({ startedAt, metadata: { reserved_recall_minutes: 60 } })).toEqual(
      startedAt,
    );
    expect(
      recallLeaveAnchorAt({ startedAt: null, metadata: { reserved_recall_minutes: 60 } }),
    ).toBeNull();
  });
});
