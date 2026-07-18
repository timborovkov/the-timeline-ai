import type { ObjectRow } from '#src/objects/types.js';
import type { TeamScope } from '#src/team-scope.js';

import { artifactRefCitation } from '#src/citation.js';

export function serializeObjectRow(row: ObjectRow): Record<string, unknown> {
  return {
    id: row.id,
    citation: artifactRefCitation({
      kind: row.type === 'task' || row.type === 'follow_up' ? 'task' : 'object',
      id: row.id,
    }),
    name: row.canonicalName,
    type: row.type,
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    owner_user_id: row.ownerUserId,
    assignee_user_id: row.assigneeUserId,
    due_at: row.dueAt?.toISOString() ?? null,
    task_category: row.taskCategory,
    task_category_mode: row.taskCategoryMode,
    task_category_status: row.taskCategoryStatus,
    updated_at: row.updatedAt.toISOString(),
    archived: row.archivedAt !== null,
    aliases: row.aliases.slice(0, 20),
  };
}

export async function serializeObjectRowsWithProjects(
  scope: TeamScope,
  rows: ObjectRow[],
): Promise<Record<string, unknown>[]> {
  const projects = await scope.objects.listPrimaryProjectsForTasks(
    rows.filter((row) => row.type === 'task').map((row) => row.id),
  );
  const byTask = new Map(projects.map((project) => [project.taskId, project] as const));
  return rows.map((row) => {
    const project = byTask.get(row.id);
    return {
      ...serializeObjectRow(row),
      primary_project: project
        ? {
            id: project.projectId,
            name: project.projectName,
            archived: project.archivedAt !== null,
          }
        : null,
    };
  });
}
