import { describe, expect, it, vi } from 'vitest';

import type { ObjectListFilter, ObjectRow, ObjectType } from '@timeline/shared/objects/types';

import {
  boardAddItemTypeOptions,
  loadBoardAddItemCandidates,
} from '@/lib/board-add-item-candidates';

function objectRow(input: {
  id: string;
  type: ObjectType;
  canonicalName?: string;
  updatedAt?: Date;
  archivedAt?: Date | null;
}): ObjectRow {
  return {
    id: input.id,
    type: input.type,
    canonicalName: input.canonicalName ?? input.id,
    status: 'open',
    stage: null,
    priority: null,
    ownerUserId: null,
    assigneeUserId: null,
    dueAt: null,
    agentSuggested: false,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    aliases: [],
    metadata: {},
    archivedAt: input.archivedAt ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: input.updatedAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('boardAddItemTypeOptions', () => {
  it('always includes people and companies, with recommended types first', () => {
    expect(boardAddItemTypeOptions(['deal', 'project'])).toEqual([
      'deal',
      'project',
      'person',
      'company',
      'topic',
      'other',
      'vendor',
      'incident',
      'document',
      'decision',
      'hiring_loop',
      'task',
      'follow_up',
    ]);
  });
});

describe('loadBoardAddItemCandidates', () => {
  it('loads a quota of each recommended type instead of a mixed recency dump', async () => {
    const listObjects = vi.fn((filter: ObjectListFilter) => {
      if (filter.type === 'company') {
        return Promise.resolve([
          objectRow({
            id: 'company-1',
            type: 'company',
            canonicalName: 'Northstar',
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          }),
        ]);
      }
      if (filter.type === 'person') {
        return Promise.resolve([objectRow({ id: 'person-1', type: 'person', canonicalName: 'Ada' })]);
      }
      if (filter.type === 'task') {
        return Promise.resolve(
          Array.from({ length: 200 }, (_, index) =>
            objectRow({
              id: `task-${index}`,
              type: 'task',
              updatedAt: new Date('2026-06-01T00:00:00.000Z'),
            }),
          ),
        );
      }
      return Promise.resolve([]);
    });

    const rows = await loadBoardAddItemCandidates({
      listObjects,
      recommendedTypes: ['company', 'person'],
      limit: 40,
    });

    expect(listObjects).toHaveBeenCalledWith({
      type: 'company',
      archived: false,
      limit: 24,
    });
    expect(listObjects).toHaveBeenCalledWith({
      type: 'person',
      archived: false,
      limit: 24,
    });
    expect(listObjects).not.toHaveBeenCalledWith(
      expect.objectContaining({ archived: false, limit: 40 }),
    );
    expect(rows.map((row) => row.id)).toEqual(['company-1', 'person-1']);
  });

  it('falls back to a mixed window when the board has no recommended types', async () => {
    const mixed = [objectRow({ id: 'task-1', type: 'task' })];
    const listObjects = vi.fn((filter: ObjectListFilter) =>
      Promise.resolve(filter.type ? [] : mixed),
    );

    await expect(
      loadBoardAddItemCandidates({
        listObjects,
        recommendedTypes: [],
        limit: 200,
      }),
    ).resolves.toEqual(mixed);
    expect(listObjects).toHaveBeenCalledWith({ archived: false, limit: 200 });
  });
});
