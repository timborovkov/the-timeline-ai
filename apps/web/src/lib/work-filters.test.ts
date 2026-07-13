import { describe, expect, it } from 'vitest';

import {
  boardItemFilterFromWorkFilters,
  objectListFilterFromWorkFilters,
  parseWorkFilters,
  taskObjectFilterFromWorkFilters,
} from '@/lib/work-filters';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const LANE_ID = '00000000-0000-4000-8000-000000000002';
const PROJECT_ID = '00000000-0000-4000-8000-000000000003';

describe('work filters', () => {
  it('ignores direct category URL filters while the emergency UI control is disabled', () => {
    const parsed = parseWorkFilters(
      { category: 'engineering,uncategorized', project: PROJECT_ID },
      { taskCategoriesEnabled: false },
    );
    expect(parsed.category).toBe('');
    expect(parsed.project).toBe(PROJECT_ID);
    expect(objectListFilterFromWorkFilters(parsed)).not.toHaveProperty('taskCategory');
  });

  it('maps URL params to object filters with sentinels and date ranges', () => {
    const parsed = parseWorkFilters({
      q: ' audit ',
      type: 'task',
      status: 'todo,doing',
      assignee: 'unassigned',
      priority: 'none',
      dueFrom: '2026-08-01',
      dueTo: '2026-08-05',
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      updatedFrom: '2026-07-15',
      updatedTo: '2026-08-02',
    });

    expect(objectListFilterFromWorkFilters(parsed)).toEqual({
      query: 'audit',
      type: 'task',
      status: ['todo', 'doing'],
      assigneeUserId: null,
      priorityNull: true,
      dueAfter: new Date('2026-08-01T00:00:00.000Z'),
      dueBefore: new Date('2026-08-06T00:00:00.000Z'),
      createdAfter: new Date('2026-07-01T00:00:00.000Z'),
      createdBefore: new Date('2026-08-01T00:00:00.000Z'),
      updatedAfter: new Date('2026-07-15T00:00:00.000Z'),
      updatedBefore: new Date('2026-08-03T00:00:00.000Z'),
    });
  });

  it('maps board URL params to board item and object filters', () => {
    const parsed = parseWorkFilters({
      q: 'pilot',
      type: 'company',
      status: 'open',
      lane: LANE_ID,
      responsible: USER_ID,
      assignee: USER_ID,
      priority: '1',
      due: 'none',
      createdFrom: '2026-06-01',
      updatedTo: '2026-06-30',
    });

    expect(parsed).toEqual(
      expect.objectContaining({
        responsible: USER_ID,
        assignee: USER_ID,
      }),
    );
    expect(boardItemFilterFromWorkFilters(parsed)).toEqual({
      query: 'pilot',
      laneId: LANE_ID,
      responsibleUserId: USER_ID,
      priority: 1,
      dueNull: true,
      createdAfter: new Date('2026-06-01T00:00:00.000Z'),
      updatedBefore: new Date('2026-07-01T00:00:00.000Z'),
      object: {
        type: 'company',
        status: ['open'],
        assigneeUserId: USER_ID,
        archived: false,
      },
    });
  });

  it('maps multi-value type and people filters', () => {
    const parsed = parseWorkFilters({
      type: 'task,project',
      status: ['todo', 'doing'],
      owner: USER_ID,
      assignee: `${USER_ID},${LANE_ID},unassigned`,
      responsible: `${USER_ID},${LANE_ID}`,
    });

    expect(objectListFilterFromWorkFilters(parsed)).toMatchObject({
      type: ['task', 'project'],
      status: ['todo', 'doing'],
      ownerUserId: USER_ID,
      assigneeUserId: [USER_ID, LANE_ID, null],
    });
    const boardFilter = boardItemFilterFromWorkFilters(parsed);
    expect(boardFilter).toMatchObject({
      responsibleUserId: [USER_ID, LANE_ID],
    });
    expect(boardFilter.object).toMatchObject({
      type: ['task', 'project'],
      assigneeUserId: [USER_ID, LANE_ID, null],
    });
  });

  it('normalizes canceled status params while keeping legacy rows filterable', () => {
    const parsed = parseWorkFilters({ status: 'todo,canceled,cancelled' });

    expect(parsed.status).toBe('todo,cancelled');
    expect(objectListFilterFromWorkFilters(parsed)).toMatchObject({
      status: ['todo', 'cancelled', 'canceled'],
    });
    expect(boardItemFilterFromWorkFilters(parsed).object).toMatchObject({
      status: ['todo', 'cancelled', 'canceled'],
    });
  });

  it('maps named categories plus Uncategorized with OR semantics and ANDs project', () => {
    const parsed = parseWorkFilters({
      category: 'engineering,uncategorized,not-a-category',
      project: `${PROJECT_ID},not-a-uuid`,
    });

    expect(parsed).toMatchObject({
      category: 'engineering,uncategorized',
      project: PROJECT_ID,
    });
    expect(objectListFilterFromWorkFilters(parsed)).toMatchObject({
      taskCategory: ['engineering'],
      taskCategoryNull: true,
      primaryProjectId: [PROJECT_ID],
    });
    expect(boardItemFilterFromWorkFilters(parsed).object).toMatchObject({
      taskCategory: ['engineering'],
      taskCategoryNull: true,
      primaryProjectId: [PROJECT_ID],
    });
  });

  it('combines canonical task status aliases with category and project filters', () => {
    const parsed = parseWorkFilters({
      status: 'backlog,open',
      category: 'engineering',
      project: PROJECT_ID,
    });

    expect(taskObjectFilterFromWorkFilters(parsed)).toMatchObject({
      type: 'task',
      archived: false,
      status: ['backlog', 'suggested', 'proposed', 'open', 'todo'],
      taskCategory: ['engineering'],
      primaryProjectId: [PROJECT_ID],
    });
  });
});
