import { describe, expect, it } from 'vitest';

import { curatedKanbanSaveState } from '@/components/boards/curated-kanban-state';

describe('curatedKanbanSaveState', () => {
  it('does not report saved after the final move in a failed batch settles', () => {
    expect(curatedKanbanSaveState(0, true)).toBe('idle');
  });

  it('continues reporting saving while other moves are still in flight', () => {
    expect(curatedKanbanSaveState(1, true)).toBe('saving');
  });

  it('reports saved only when all moves finish without failures', () => {
    expect(curatedKanbanSaveState(0, false)).toBe('saved');
  });
});
