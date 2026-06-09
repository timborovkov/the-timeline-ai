import { describe, expect, it } from 'vitest';

import {
  MAX_OBJECT_MERGE_SELECTION,
  objectMergeHref,
  parseObjectMergeIds,
} from '@/lib/object-merge';

const ids = Array.from(
  { length: MAX_OBJECT_MERGE_SELECTION + 1 },
  (_, index) => `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
);
const firstId = ids[0] ?? '';
const secondId = ids[1] ?? '';

describe('object merge URL helpers', () => {
  it('parses every valid selected id without silently capping the URL payload', () => {
    expect(parseObjectMergeIds(ids.join(','))).toEqual(ids);
  });

  it('deduplicates ids while preserving selection order', () => {
    expect(parseObjectMergeIds([firstId, `${secondId},${firstId}`])).toEqual([firstId, secondId]);
  });

  it('builds the merge URL from the complete selection', () => {
    const href = objectMergeHref(ids);

    expect(
      parseObjectMergeIds(new URL(`http://timeline.test${href}`).searchParams.get('ids') ?? ''),
    ).toEqual(ids);
  });
});
