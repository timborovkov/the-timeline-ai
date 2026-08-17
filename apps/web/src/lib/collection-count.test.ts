import { describe, expect, it } from 'vitest';

import { formatCollectionCount } from '@/lib/collection-count';

describe('formatCollectionCount', () => {
  it('shows the inventory total when the collection is unfiltered', () => {
    expect(formatCollectionCount({ matching: 847, total: 847, filtered: false })).toBe('847');
  });

  it('shows matching of total when filters are active', () => {
    expect(formatCollectionCount({ matching: 24, total: 847, filtered: true })).toBe('24 of 847');
  });
});
