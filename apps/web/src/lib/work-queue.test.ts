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
    const item = objectQueueItem(task(), 'user-1', new Date('2026-06-01T00:00:00.000Z'), 'UTC');

    expect(item?.title).toBe('the-timeline-ai: Add cursor pagination');
  });

  it('humanizes multiword object types without repeating them in the subtitle', () => {
    const item = objectQueueItem(
      task({ type: 'follow_up', status: 'in_progress' }),
      'user-1',
      new Date('2026-06-01T00:00:00.000Z'),
      'UTC',
    );

    expect(item?.sourceLabel).toBe('Follow up');
    expect(item?.status).toBe('in_progress');
    expect(item?.subtitle).toBe('');
    expect(item?.subtitle).not.toContain('_');
  });

  it('loads assigned standalone work even when it has no board item or due date', async () => {
    const assigned = task({ id: 'assigned-standalone', dueAt: null });
    const listObjects = (filter: objects.ObjectListFilter) =>
      Promise.resolve(
        filter.assigneeUserId === 'user-1' && filter.dueDateRange === undefined ? [assigned] : [],
      );

    const rows = await listWorkQueueObjects(
      { listObjects },
      {
        userId: 'user-1',
        now: new Date('2026-06-01T00:00:00.000Z'),
        timezone: 'UTC',
      },
    );

    expect(rows).toContain(assigned);
  });

  it('loads visible overdue tasks even when they are assigned to another user', async () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    const overdue = task({
      id: 'team-overdue',
      assigneeUserId: 'user-2',
      dueAt: new Date('2026-07-19T00:00:00.000Z'),
    });
    const listObjects = (filter: objects.ObjectListFilter) =>
      Promise.resolve(
        filter.type === 'task' &&
          filter.dueDateRange?.to === '2026-07-20' &&
          filter.ownerUserId === undefined &&
          filter.assigneeUserId === undefined
          ? [overdue]
          : [],
      );

    const rows = await listWorkQueueObjects(
      { listObjects },
      {
        userId: 'user-1',
        now,
        timezone: 'UTC',
      },
    );

    expect(rows).toContain(overdue);
  });
});
