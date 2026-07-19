import { describe, expect, it } from 'vitest';

import type * as objects from '@timeline/shared/objects/types';

import { listWorkQueueObjects, objectQueueItem } from '@/lib/work-queue';

function task(input: Partial<objects.ObjectRow> = {}): objects.ObjectRow {
  return {
    id: 'task-1',
    type: 'task',
    canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
    status: 'todo',
    stage: null,
    priority: 2,
    ownerUserId: null,
    assigneeUserId: 'user-1',
    dueAt: new Date('2026-07-04T00:00:00.000Z'),
    agentSuggested: false,
    taskCategory: null,
    taskCategoryMode: null,
    taskCategorySource: null,
    taskCategoryStatus: null,
    taskCategoryUpdatedAt: null,
    archivedAt: null,
    aliases: [],
    metadata: {
      integration_provider: 'github',
      integration_external_id: 'timborovkov/the-timeline-ai#202',
      display_title: 'the-timeline-ai: Add cursor pagination',
      display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
    },
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    ...input,
  };
}

describe('objectQueueItem', () => {
  it('uses source-tracked display titles for integration-derived task queue titles', () => {
    const item = objectQueueItem(
      task(),
      'user-1',
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-08T00:00:00.000Z'),
    );

    expect(item?.title).toBe('the-timeline-ai: Add cursor pagination');
  });

  it('humanizes multiword object types and statuses', () => {
    const item = objectQueueItem(
      task({ type: 'follow_up', status: 'in_progress' }),
      'user-1',
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-08T00:00:00.000Z'),
    );

    expect(item?.subtitle).toBe('Follow up · In progress');
    expect(item?.subtitle).not.toContain('_');
  });

  it('loads assigned standalone work even when it has no board item or due date', async () => {
    const assigned = task({ id: 'assigned-standalone', dueAt: null });
    const listObjects = (filter: objects.ObjectListFilter) =>
      Promise.resolve(
        filter.assigneeUserId === 'user-1' && filter.dueBefore === undefined ? [assigned] : [],
      );

    const rows = await listWorkQueueObjects(
      { listObjects },
      'user-1',
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(rows).toContain(assigned);
  });
});
