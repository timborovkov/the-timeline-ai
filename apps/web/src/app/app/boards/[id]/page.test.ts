import { describe, expect, it } from 'vitest';

import { boardViewHref } from '@/lib/board-links';

describe('boardViewHref', () => {
  it('preserves the selected item while switching board views', () => {
    expect(boardViewHref('board-1', 'table', 'item-1')).toBe(
      '/app/boards/board-1?view=table&item=item-1',
    );
  });

  it('omits the selected item when no card detail panel is open', () => {
    expect(boardViewHref('board-1', 'list', null)).toBe('/app/boards/board-1?view=list');
  });
});
