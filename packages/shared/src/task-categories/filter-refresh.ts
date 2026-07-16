import { type Db, taskCategoryFilterVersions } from '@timeline/db';
import { type SQLWrapper, and, eq, inArray, sql } from 'drizzle-orm';

import type { TaskCategoryFilterKey } from '#src/task-categories/types.js';

export interface TaskCategoryFilterRefreshState {
  token: string;
  changed: boolean;
  pending: boolean;
}

export async function readTaskCategoryFilterRefreshState(
  db: Db,
  teamId: string,
  categoryKeys: readonly TaskCategoryFilterKey[],
  pendingQuery: SQLWrapper,
  baselineToken?: string,
): Promise<TaskCategoryFilterRefreshState> {
  const keys = [...new Set(categoryKeys)].sort();
  if (keys.length === 0) return { token: '', changed: false, pending: false };
  const versionCondition = and(
    eq(taskCategoryFilterVersions.teamId, teamId),
    inArray(taskCategoryFilterVersions.category, keys),
  );
  const [row] = await db
    .select({
      versions: sql<Record<string, number>>`coalesce((
        SELECT jsonb_object_agg(${taskCategoryFilterVersions.category}, ${taskCategoryFilterVersions.version})
        FROM ${taskCategoryFilterVersions}
        WHERE ${versionCondition}
      ), '{}'::jsonb)`,
      pending: sql<boolean>`exists (${pendingQuery})`,
    })
    .from(sql`(SELECT 1) AS task_category_refresh_snapshot`);
  const token = keys.map((key) => `${key}:${row?.versions[key] ?? 0}`).join(',');
  return {
    token,
    changed: baselineToken !== undefined && token !== baselineToken,
    pending: row?.pending ?? false,
  };
}
