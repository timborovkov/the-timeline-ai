import { encodeCursor } from '@timeline/shared/pagination';

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
): Promise<TaskRowsPage> {
  const rows = await objectScope.listObjects({
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
): Promise<TaskCounts> {
  const base = {
    type: 'task' as const,
    archived: false,
  };
  const [total, open, overdue] = await Promise.all([
    objectScope.countObjects(base),
    objectScope.countObjects({
      ...base,
      statusNot: [...TASK_OPEN_STATUSES_EXCLUDED],
    }),
    objectScope.countObjects({
      ...base,
      dueBefore: now,
      statusNot: [...TASK_OPEN_STATUSES_EXCLUDED],
    }),
  ]);
  return { total, open, overdue };
}
