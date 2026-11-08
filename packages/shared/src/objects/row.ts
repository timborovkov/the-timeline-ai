import type { ObjectRow } from '#src/objects/types.js';
import type {
  TaskCategory,
  TaskCategoryMode,
  TaskCategorySource,
  TaskCategoryStatus,
} from '#src/task-categories/types.js';
import type { entities } from '@timeline/db';
type EntityRow = typeof entities.$inferSelect;

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function toObjectRow(row: EntityRow): ObjectRow {
  const aliases = stringArrayFromUnknown(row.aliases);
  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    type: row.type,
    canonicalName: row.canonicalName,
    status: row.status,
    stage: row.stage,
    priority: row.priority,
    ownerUserId: row.ownerUserId,
    assigneeUserId: row.assigneeUserId,
    dueAt: row.dueAt,
    taskCategory: row.taskCategory as TaskCategory | null,
    taskCategoryMode: row.taskCategoryMode as TaskCategoryMode | null,
    taskCategorySource: row.taskCategorySource as TaskCategorySource | null,
    taskCategoryStatus: row.taskCategoryStatus as TaskCategoryStatus | null,
    taskCategoryUpdatedAt: row.taskCategoryUpdatedAt,
    // `entities.agent_suggested` is legacy single-row provenance. Approval
    // state now lives in agent_suggestions projected from reconciliation outputs.
    agentSuggested: false,
    archivedAt: row.archivedAt,
    aliases,
    metadata,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}
