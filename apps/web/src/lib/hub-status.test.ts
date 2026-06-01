import { describe, expect, it } from 'vitest';

import { attentionCount } from '@/lib/hub-status';

describe('hub status helpers', () => {
  it('aggregates only positive attention counts', () => {
    expect(attentionCount(2, 0, -1, 3)).toBe(5);
  });
});
