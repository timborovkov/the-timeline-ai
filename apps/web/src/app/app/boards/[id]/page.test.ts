import { describe, expect, it } from 'vitest';

import { boardViewHref, normalizeBoardView } from '@/lib/board-links';

describe('boardViewHref', () => {
  it('preserves the selected item while switching board views', () => {
    expect(boardViewHref('board-1', 'list', 'item-1')).toBe(
      '/app/boards/board-1?view=list&item=item-1',
    );
  });

  it('omits the selected item when no card detail panel is open', () => {
    expect(boardViewHref('board-1', 'list', null)).toBe('/app/boards/board-1?view=list');
  });
});

describe('normalizeBoardView', () => {
  it('keeps kanban and list, and treats legacy table bookmarks as list', () => {
    expect(normalizeBoardView('kanban')).toBe('kanban');
    expect(normalizeBoardView('list')).toBe('list');
    expect(normalizeBoardView('table')).toBe('list');
    expect(normalizeBoardView(undefined)).toBe('kanban');
  });
});
