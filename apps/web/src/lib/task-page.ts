import { encodeCursor } from '@timeline/shared/pagination';
import { workspaceDueDateBoundaries } from '@timeline/shared/time';

import type * as objects from '@timeline/shared/objects';

import { TASK_BOARD_PAGE_SIZE, TASK_OPEN_STATUSES_EXCLUDED } from '@/lib/task-board-config';

export interface TaskObjectScope {
  listObjects(filter: objects.ObjectListFilter): Promise<objects.ObjectRow[]>;
  countObjects(filter: objects.ObjectCountFilter): Promise<number>;
}

export interface TaskRowsPage {
  rows: objects.ObjectRow[];
  nextCursor: string | null;
}

export interface TaskCounts {
  total: number;
  open: number;
  overdue: number;
}

export async function loadTaskRowsPage(
  objectScope: Pick<TaskObjectScope, 'listObjects'>,
  cursor?: string | null,
  filter: objects.ObjectListFilter = {},
): Promise<TaskRowsPage> {
  const rows = await objectScope.listObjects({
    ...filter,
    type: 'task',
    archived: false,
    limit: TASK_BOARD_PAGE_SIZE + 1,
    cursor,
  });
  const pageRows = rows.slice(0, TASK_BOARD_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > TASK_BOARD_PAGE_SIZE && last
        ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id })
        : null,
  };
}

export async function countTaskRows(
  objectScope: Pick<TaskObjectScope, 'countObjects'>,
  now = new Date(),
  filter: objects.ObjectCountFilter = {},
  timezone = 'UTC',
): Promise<TaskCounts> {
  const boundaries = workspaceDueDateBoundaries(timezone, now);
  const base = {
    ...filter,
    type: 'task' as const,
    archived: false,
  };
  const [total, open, overdue] = await Promise.all([
    objectScope.countObjects(base),
    objectScope.countObjects({
      ...base,
      statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED],
    }),
    objectScope.countObjects({
      ...base,
      dueDateRange: { timezone, to: boundaries.today },
      statusNotCaseInsensitive: [...TASK_OPEN_STATUSES_EXCLUDED],
    }),
  ]);
  return { total, open, overdue };
}
