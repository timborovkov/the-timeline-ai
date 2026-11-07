import { createHash } from 'node:crypto';
import {
  type Db,
  entities,
  entityRelationships,
  objectChanges,
  taskCategoryAssignments,
  taskCategoryProjectInvalidations,
} from '@timeline/db';
import { type SQL, type SQLWrapper, and, asc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { childLogger } from '#src/logger.js';
import { recordFromUnknown, stringArrayFromUnknown, toObjectRow } from '#src/objects/row.js';
import type { ObjectRow, UpdateActor } from '#src/objects/types.js';
import * as embedQueue from '#src/queue/queues.js';
import {
  buildTaskCategoryPacket,
  taskCategoryInputHash,
  TASK_CATEGORY_PROMPT_VERSION,
} from '#src/task-categories/packet.js';
import {
  TASK_CATEGORY_TAXONOMY_VERSION,
  taskCategoryModeSchema,
  taskCategorySchema,
  taskCategorySourceSchema,
  taskCategoryStatusSchema,
  type TaskCategory,
  type TaskCategoryMode,
  type TaskCategorySource,
  type TaskCategoryStatus,
} from '#src/task-categories/types.js';
import type { TeamScopeCore } from '#src/team-scope.js';
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | DbTx;
type EntityRow = typeof entities.$inferSelect;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const embedLog = childLogger('objects:embed');

export function enqueueTaskCategoryBestEffort(
  data: embedQueue.TaskCategoryJobData,
  context: Record<string, unknown>,
): void {
  void embedQueue.enqueueTaskCategoryJob(data).catch((err: unknown) => {
    embedLog.error({ err, ...context }, 'failed to enqueue task category job');
  });
}

export interface ProjectTaskCategoryInvalidation {
  jobs: { taskId: string; inputHash: string }[];
  fanout: { projectId: string; projectVersion: string; afterTaskId: string } | null;
}

export function hasExactlyOneCanonicalProjectEdge(teamId: string, taskId: SQLWrapper): SQL {
  return sql`1 = (
    SELECT count(*)
    FROM entity_relationships AS candidate_project_rel
    INNER JOIN entities AS candidate_project
      ON candidate_project.id = candidate_project_rel.to_entity_id
      AND candidate_project.team_id = candidate_project_rel.team_id
    WHERE candidate_project_rel.team_id = ${teamId}
      AND candidate_project_rel.from_entity_id = ${taskId}
      AND candidate_project_rel.kind = 'child'
      AND candidate_project.type = 'project'
      AND candidate_project.merged_into_id IS NULL
  )`;
}

export async function invalidateLinkedTaskCategoriesForProject(
  tx: DbTx,
  teamId: string,
  project: { id: string; canonicalName: string },
): Promise<ProjectTaskCategoryInvalidation> {
  const linkedTasks = await tx
    .select({
      id: entities.id,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
      metadata: entities.metadata,
    })
    .from(entityRelationships)
    .innerJoin(
      entities,
      and(
        eq(entities.teamId, entityRelationships.teamId),
        eq(entities.id, entityRelationships.fromEntityId),
        eq(entities.type, 'task'),
        eq(entities.taskCategoryMode, 'automatic'),
        isNull(entities.archivedAt),
        isNull(entities.mergedIntoId),
      ),
    )
    .where(
      and(
        eq(entityRelationships.teamId, teamId),
        eq(entityRelationships.toEntityId, project.id),
        eq(entityRelationships.kind, 'child'),
        hasExactlyOneCanonicalProjectEdge(teamId, entities.id),
      ),
    )
    .orderBy(asc(entities.id))
    .limit(500);
  const jobs: ProjectTaskCategoryInvalidation['jobs'] = [];
  for (const task of linkedTasks) {
    const packet = buildTaskCategoryPacket({
      title: task.canonicalName,
      aliases: stringArrayFromUnknown(task.aliases),
      metadata: recordFromUnknown(task.metadata),
      primaryProjectName: project.canonicalName,
    });
    const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
    const updated = await tx
      .update(entities)
      .set({
        taskCategoryStatus: 'pending',
        taskCategoryRequestedInputHash: inputHash,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(entities.teamId, teamId),
          eq(entities.id, task.id),
          eq(entities.taskCategoryMode, 'automatic'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
          sql`EXISTS (
            SELECT 1
            FROM entity_relationships AS current_project_rel
            WHERE current_project_rel.team_id = ${teamId}
              AND current_project_rel.from_entity_id = ${task.id}
              AND current_project_rel.to_entity_id = ${project.id}
              AND current_project_rel.kind = 'child'
          )`,
        ),
      )
      .returning({ id: entities.id });
    if (updated.length > 0) jobs.push({ taskId: task.id, inputHash });
  }
  const fanout =
    linkedTasks.length === 500
      ? {
          projectId: project.id,
          projectVersion: taskProjectVersion(project.id, project.canonicalName),
          afterTaskId: linkedTasks.at(-1)?.id ?? project.id,
        }
      : null;
  if (fanout) {
    await tx
      .insert(taskCategoryProjectInvalidations)
      .values({
        teamId,
        projectId: fanout.projectId,
        projectVersion: fanout.projectVersion,
        afterTaskId: fanout.afterTaskId,
      })
      .onConflictDoUpdate({
        target: [
          taskCategoryProjectInvalidations.teamId,
          taskCategoryProjectInvalidations.projectId,
        ],
        set: {
          projectVersion: fanout.projectVersion,
          afterTaskId: fanout.afterTaskId,
          updatedAt: new Date(),
        },
      });
  } else {
    await tx
      .delete(taskCategoryProjectInvalidations)
      .where(
        and(
          eq(taskCategoryProjectInvalidations.teamId, teamId),
          eq(taskCategoryProjectInvalidations.projectId, project.id),
        ),
      );
  }
  return {
    jobs,
    fanout,
  };
}

export function enqueueProjectTaskCategoryInvalidation(
  teamId: string,
  invalidation: ProjectTaskCategoryInvalidation,
  operation: string,
): void {
  for (const job of invalidation.jobs) {
    enqueueTaskCategoryBestEffort(
      { teamId, taskId: job.taskId, inputHash: job.inputHash, trigger: 'project_change' },
      { teamId, taskId: job.taskId, op: `${operation}:projectCategory` },
    );
  }
  if (invalidation.fanout) {
    enqueueTaskCategoryBestEffort(
      { kind: 'project_fanout', teamId, ...invalidation.fanout },
      { teamId, projectId: invalidation.fanout.projectId, op: `${operation}:projectFanout` },
    );
  }
}

export async function taskCategoryPacketForRow(
  tx: DbOrTx,
  teamId: string,
  task: Pick<EntityRow, 'id' | 'canonicalName' | 'aliases' | 'metadata'>,
) {
  const projects = await tx
    .select({ canonicalName: entities.canonicalName })
    .from(entityRelationships)
    .innerJoin(
      entities,
      and(
        eq(entities.teamId, entityRelationships.teamId),
        eq(entities.id, entityRelationships.toEntityId),
        eq(entities.type, 'project'),
        isNull(entities.mergedIntoId),
      ),
    )
    .where(
      and(
        eq(entityRelationships.teamId, teamId),
        eq(entityRelationships.fromEntityId, task.id),
        eq(entityRelationships.kind, 'child'),
      ),
    )
    .orderBy(asc(entityRelationships.createdAt), asc(entityRelationships.id))
    .limit(2);
  const project = projects.length === 1 ? projects[0] : null;
  return buildTaskCategoryPacket({
    title: task.canonicalName,
    aliases: stringArrayFromUnknown(task.aliases),
    metadata: recordFromUnknown(task.metadata),
    primaryProjectName: project?.canonicalName ?? null,
  });
}

export async function getTaskCategoryClassificationInput(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
): Promise<{
  packet: ReturnType<typeof buildTaskCategoryPacket>;
  inputHash: string;
  requestedInputHash: string;
} | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) return null;
  const [task] = await db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.teamId, scope.teamId),
        eq(entities.id, taskId),
        eq(entities.type, 'task'),
        eq(entities.taskCategoryMode, 'automatic'),
        eq(entities.taskCategoryStatus, 'pending'),
        isNotNull(entities.taskCategoryRequestedInputHash),
        isNull(entities.archivedAt),
        isNull(entities.mergedIntoId),
      ),
    )
    .limit(1);
  if (!task?.taskCategoryRequestedInputHash) return null;
  const packet = await taskCategoryPacketForRow(db, scope.teamId, task);
  return {
    packet,
    inputHash: taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id),
    requestedInputHash: task.taskCategoryRequestedInputHash,
  };
}

export async function refreshTaskCategoryClassificationRequest(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  expectedInputHash: string,
): Promise<{
  packet: ReturnType<typeof buildTaskCategoryPacket>;
  inputHash: string;
} | null> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) return null;
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          eq(entities.taskCategoryMode, 'automatic'),
          eq(entities.taskCategoryStatus, 'pending'),
          eq(entities.taskCategoryRequestedInputHash, expectedInputHash),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!task) return null;

    const packet = await taskCategoryPacketForRow(tx, scope.teamId, task);
    const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
    if (inputHash === expectedInputHash) return { packet, inputHash };

    await tx
      .update(entities)
      .set({
        taskCategoryRequestedInputHash: inputHash,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.taskCategoryMode, 'automatic'),
          eq(entities.taskCategoryStatus, 'pending'),
          eq(entities.taskCategoryRequestedInputHash, expectedInputHash),
        ),
      );
    return { packet, inputHash };
  });
}

export async function setTaskCategory(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  categoryInput: TaskCategory,
  actor: UpdateActor,
): Promise<{ object: ObjectRow; changeId: string }> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId)) throw new Error('Invalid entity id');
  if (actor.kind !== 'user' || !actor.userId) throw new Error('A teammate must set the category');
  const category = taskCategorySchema.parse(categoryInput);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!current) throw new Error('Task not found');
    const [row] = await tx
      .update(entities)
      .set({
        taskCategory: category,
        taskCategoryMode: 'manual',
        taskCategorySource: 'user',
        taskCategoryStatus: 'ready',
        taskCategoryAppliedInputHash: null,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!row) throw new Error('Category update failed');
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: taskId,
      category,
      source: 'user',
      mode: 'manual',
      actorUserId: actor.userId,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      outcome: 'applied',
    });
    const [change] = await tx
      .insert(objectChanges)
      .values({
        teamId: scope.teamId,
        entityId: taskId,
        actorUserId: actor.userId,
        actorKind: 'user',
        status: 'applied',
        field: 'taskCategory',
        previousValue: taskCategoryStateSnapshot(current),
        newValue: taskCategoryStateSnapshot(row),
        sourceEventId: null,
      })
      .returning({ id: objectChanges.id });
    if (!change) throw new Error('Category audit failed');
    return { row, changeId: change.id };
  });
  return { object: toObjectRow(result.row), changeId: result.changeId };
}

interface TaskCategoryStateSnapshot {
  category: TaskCategory | null;
  mode: TaskCategoryMode | null;
  source: TaskCategorySource | null;
  status: TaskCategoryStatus | null;
  appliedInputHash: string | null;
  requestedInputHash: string | null;
  taxonomyVersion: string | null;
}

function taskCategoryStateSnapshot(row: EntityRow): TaskCategoryStateSnapshot {
  return {
    category: row.taskCategory as TaskCategory | null,
    mode: row.taskCategoryMode as TaskCategoryMode | null,
    source: row.taskCategorySource as TaskCategorySource | null,
    status: row.taskCategoryStatus as TaskCategoryStatus | null,
    appliedInputHash: row.taskCategoryAppliedInputHash,
    requestedInputHash: row.taskCategoryRequestedInputHash,
    taxonomyVersion: row.taskCategoryTaxonomyVersion,
  };
}

function taskCategoryStateSnapshotFromUnknown(value: unknown): TaskCategoryStateSnapshot | null {
  const record = recordFromUnknown(value);
  const category = record.category === null ? null : taskCategorySchema.safeParse(record.category);
  const mode = record.mode === null ? null : taskCategoryModeSchema.safeParse(record.mode);
  const source = record.source === null ? null : taskCategorySourceSchema.safeParse(record.source);
  const status = record.status === null ? null : taskCategoryStatusSchema.safeParse(record.status);
  if (
    (category !== null && !category.success) ||
    (mode !== null && !mode.success) ||
    (source !== null && !source.success) ||
    (status !== null && !status.success)
  ) {
    return null;
  }
  const nullableString = (candidate: unknown): string | null =>
    typeof candidate === 'string' ? candidate : null;
  return {
    category: category === null ? null : category.data,
    mode: mode === null ? null : mode.data,
    source: source === null ? null : source.data,
    status: status === null ? null : status.data,
    appliedInputHash: nullableString(record.appliedInputHash),
    requestedInputHash: nullableString(record.requestedInputHash),
    taxonomyVersion: nullableString(record.taxonomyVersion),
  };
}

function taskProjectVersion(projectId: string, projectName: string): string {
  return createHash('sha256').update(`${projectId}\0${projectName}`).digest('hex');
}

export async function invalidateTaskCategoriesForProject(
  db: Db,
  scope: TeamScopeCore,
  input: {
    projectId: string;
    projectVersion: string;
    afterTaskId: string | null;
    limit?: number;
  },
): Promise<{ jobs: { taskId: string; inputHash: string }[]; nextCursor: string | null }> {
  await scope.requireMembership();
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 500);
  return db.transaction(async (tx) => {
    const [invalidation] = await tx
      .select()
      .from(taskCategoryProjectInvalidations)
      .where(
        and(
          eq(taskCategoryProjectInvalidations.teamId, scope.teamId),
          eq(taskCategoryProjectInvalidations.projectId, input.projectId),
        ),
      )
      .for('update')
      .limit(1);
    if (invalidation?.projectVersion !== input.projectVersion) {
      return { jobs: [], nextCursor: null };
    }
    if (invalidation.afterTaskId !== input.afterTaskId) {
      return { jobs: [], nextCursor: invalidation.afterTaskId };
    }
    const [project] = await tx
      .select({ id: entities.id, canonicalName: entities.canonicalName })
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, input.projectId),
          eq(entities.type, 'project'),
          isNull(entities.mergedIntoId),
        ),
      )
      .limit(1);
    if (
      !project ||
      taskProjectVersion(project.id, project.canonicalName) !== input.projectVersion
    ) {
      await tx
        .delete(taskCategoryProjectInvalidations)
        .where(eq(taskCategoryProjectInvalidations.id, invalidation.id));
      return { jobs: [], nextCursor: null };
    }
    const rows = await tx
      .select({
        id: entities.id,
        canonicalName: entities.canonicalName,
        aliases: entities.aliases,
        metadata: entities.metadata,
      })
      .from(entityRelationships)
      .innerJoin(
        entities,
        and(
          eq(entities.teamId, entityRelationships.teamId),
          eq(entities.id, entityRelationships.fromEntityId),
          eq(entities.type, 'task'),
          eq(entities.taskCategoryMode, 'automatic'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .where(
        and(
          eq(entityRelationships.teamId, scope.teamId),
          eq(entityRelationships.toEntityId, project.id),
          eq(entityRelationships.kind, 'child'),
          hasExactlyOneCanonicalProjectEdge(scope.teamId, entities.id),
          input.afterTaskId ? sql`${entities.id} > ${input.afterTaskId}` : undefined,
        ),
      )
      .orderBy(asc(entities.id))
      .limit(limit);
    const jobs: { taskId: string; inputHash: string }[] = [];
    for (const task of rows) {
      const packet = buildTaskCategoryPacket({
        title: task.canonicalName,
        aliases: stringArrayFromUnknown(task.aliases),
        metadata: recordFromUnknown(task.metadata),
        primaryProjectName: project.canonicalName,
      });
      const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      const updated = await tx
        .update(entities)
        .set({
          taskCategoryStatus: 'pending',
          taskCategoryRequestedInputHash: inputHash,
          taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
          taskCategoryUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(entities.teamId, scope.teamId),
            eq(entities.id, task.id),
            eq(entities.taskCategoryMode, 'automatic'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
            sql`EXISTS (
              SELECT 1
              FROM entity_relationships AS current_project_rel
              WHERE current_project_rel.team_id = ${scope.teamId}
                AND current_project_rel.from_entity_id = ${task.id}
                AND current_project_rel.to_entity_id = ${project.id}
                AND current_project_rel.kind = 'child'
            )`,
          ),
        )
        .returning({ id: entities.id });
      if (updated.length > 0) jobs.push({ taskId: task.id, inputHash });
    }
    const nextCursor = rows.length === limit ? (rows.at(-1)?.id ?? null) : null;
    if (nextCursor) {
      await tx
        .update(taskCategoryProjectInvalidations)
        .set({ afterTaskId: nextCursor, updatedAt: new Date() })
        .where(eq(taskCategoryProjectInvalidations.id, invalidation.id));
    } else {
      await tx
        .delete(taskCategoryProjectInvalidations)
        .where(eq(taskCategoryProjectInvalidations.id, invalidation.id));
    }
    return {
      jobs,
      nextCursor,
    };
  });
}

export async function undoTaskCategoryChange(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  changeId: string,
  actor: UpdateActor,
): Promise<ObjectRow> {
  await scope.requireMembership();
  if (!UUID_RE.test(taskId) || !UUID_RE.test(changeId)) throw new Error('Invalid category change');
  if (actor.kind !== 'user' || !actor.userId) throw new Error('A teammate must undo the category');
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!current) throw new Error('Task not found');
    const [targetChange] = await tx
      .select({
        id: objectChanges.id,
        changedAt: objectChanges.changedAt,
        previousValue: objectChanges.previousValue,
        newValue: objectChanges.newValue,
      })
      .from(objectChanges)
      .where(
        and(
          eq(objectChanges.teamId, scope.teamId),
          eq(objectChanges.entityId, taskId),
          eq(objectChanges.id, changeId),
          eq(objectChanges.field, 'taskCategory'),
          eq(objectChanges.status, 'applied'),
        ),
      )
      .limit(1);
    const targetNewState = targetChange
      ? taskCategoryStateSnapshotFromUnknown(targetChange.newValue)
      : null;
    const [laterChange] = targetChange
      ? await tx
          .select({ id: objectChanges.id })
          .from(objectChanges)
          .where(
            and(
              eq(objectChanges.teamId, scope.teamId),
              eq(objectChanges.entityId, taskId),
              eq(objectChanges.field, 'taskCategory'),
              eq(objectChanges.status, 'applied'),
              sql`${objectChanges.changedAt} > ${targetChange.changedAt}`,
            ),
          )
          .limit(1)
      : [];
    if (
      !targetChange ||
      !targetNewState ||
      laterChange ||
      JSON.stringify(taskCategoryStateSnapshot(current)) !== JSON.stringify(targetNewState)
    ) {
      throw new Error('Category changed again; this undo is stale');
    }
    let previous = taskCategoryStateSnapshotFromUnknown(targetChange.previousValue);
    if (!previous) throw new Error('Previous category state is unavailable');
    let enqueueInputHash: string | null = null;
    if (previous.mode === null) {
      const packet = await taskCategoryPacketForRow(tx, scope.teamId, current);
      enqueueInputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      previous = {
        category: null,
        mode: 'automatic',
        source: null,
        status: 'pending',
        appliedInputHash: null,
        requestedInputHash: enqueueInputHash,
        taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      };
    } else if (previous.mode === 'automatic') {
      const packet = await taskCategoryPacketForRow(tx, scope.teamId, current);
      const currentInputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
      const staleReadyState =
        previous.status === 'ready' &&
        (previous.appliedInputHash !== currentInputHash ||
          previous.taxonomyVersion !== TASK_CATEGORY_TAXONOMY_VERSION);
      if (previous.status === 'pending' || staleReadyState) {
        enqueueInputHash = currentInputHash;
        previous = {
          ...previous,
          status: 'pending',
          requestedInputHash: currentInputHash,
          taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        };
      }
    }
    if (enqueueInputHash) assertTaskCategoryAutomationAvailable('retry');
    const now = new Date();
    const [updated] = await tx
      .update(entities)
      .set({
        taskCategory: previous.category,
        taskCategoryMode: previous.mode,
        taskCategorySource: previous.source,
        taskCategoryStatus: previous.status,
        taskCategoryAppliedInputHash: previous.appliedInputHash,
        taskCategoryRequestedInputHash: previous.requestedInputHash,
        taskCategoryTaxonomyVersion: previous.taxonomyVersion,
        taskCategoryUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!updated || !previous.mode) throw new Error('Category undo failed');
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: taskId,
      category: previous.category,
      source: 'user',
      mode: previous.mode,
      actorUserId: actor.userId,
      taxonomyVersion: previous.taxonomyVersion,
      outcome: 'applied',
    });
    await tx.insert(objectChanges).values({
      teamId: scope.teamId,
      entityId: taskId,
      actorUserId: actor.userId,
      actorKind: 'user',
      status: 'applied',
      field: 'taskCategory',
      previousValue: taskCategoryStateSnapshot(current),
      newValue: previous,
      sourceEventId: null,
    });
    return { row: updated, enqueueInputHash };
  });
  if (result.enqueueInputHash) {
    enqueueTaskCategoryBestEffort(
      {
        teamId: scope.teamId,
        taskId,
        inputHash: result.enqueueInputHash,
        trigger: 'retry',
      },
      { teamId: scope.teamId, taskId, op: 'undoTaskCategoryChange:taskCategory' },
    );
  }
  return toObjectRow(result.row);
}

function assertTaskCategoryAutomationAvailable(
  trigger: 'context_change' | 'retry' | 'backfill',
): void {
  const env = getEnv();
  const enqueueEnabled =
    trigger === 'backfill'
      ? env.TASK_CATEGORY_BACKFILL_ENABLED
      : env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED;
  if (
    !env.TASK_CATEGORY_CLASSIFICATION_ENABLED ||
    !env.TASK_CATEGORY_WORKER_ENABLED ||
    !enqueueEnabled
  ) {
    throw new Error('Automatic task categorization is unavailable');
  }
}

async function transitionTaskCategoryToPending(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
  requireFailed: boolean,
  trigger: 'context_change' | 'retry' | 'backfill',
): Promise<{ object: ObjectRow; inputHash: string }> {
  await scope.requireMembership();
  assertTaskCategoryAutomationAvailable(trigger);
  if (!UUID_RE.test(taskId)) throw new Error('Invalid entity id');
  const result = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.teamId, scope.teamId),
          eq(entities.id, taskId),
          eq(entities.type, 'task'),
          isNull(entities.archivedAt),
          isNull(entities.mergedIntoId),
        ),
      )
      .for('update')
      .limit(1);
    if (!task) throw new Error('Task not found');
    if (
      requireFailed &&
      (task.taskCategoryMode !== 'automatic' || task.taskCategoryStatus !== 'failed')
    ) {
      throw new Error('Only failed automatic categories can be retried');
    }
    if (
      trigger === 'backfill' &&
      (task.taskCategory !== null ||
        task.taskCategoryMode === 'manual' ||
        (task.taskCategoryStatus !== null && task.taskCategoryStatus !== 'failed'))
    ) {
      throw new Error('Task is no longer eligible for category backfill');
    }
    const packet = await taskCategoryPacketForRow(tx, scope.teamId, task);
    const inputHash = taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id);
    const [updated] = await tx
      .update(entities)
      .set({
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'pending',
        taskCategoryRequestedInputHash: inputHash,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, taskId)))
      .returning();
    if (!updated) throw new Error('Category update failed');
    if (task.taskCategoryMode !== 'automatic') {
      await tx.insert(objectChanges).values({
        teamId: scope.teamId,
        entityId: taskId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        status: 'applied',
        field: 'taskCategoryMode',
        previousValue: task.taskCategoryMode,
        newValue: 'automatic',
        sourceEventId: null,
      });
    }
    return {
      object: toObjectRow(updated),
      inputHash,
      previous: taskCategoryStateSnapshot(task),
      previousUpdatedAt: task.taskCategoryUpdatedAt,
    };
  });
  const job = { teamId: scope.teamId, taskId, inputHash: result.inputHash, trigger };
  const requiresDurableHandoff = requireFailed || trigger === 'backfill';
  if (!requiresDurableHandoff) {
    enqueueTaskCategoryBestEffort(job, {
      teamId: scope.teamId,
      taskId,
      op: 'transitionTaskCategoryToPending',
    });
    return { object: result.object, inputHash: result.inputHash };
  }
  try {
    await embedQueue.enqueueTaskCategoryJob(job);
  } catch (error) {
    await db.transaction(async (tx) => {
      const [restored] = await tx
        .update(entities)
        .set({
          taskCategory: result.previous.category,
          taskCategoryMode: result.previous.mode,
          taskCategorySource: result.previous.source,
          taskCategoryStatus: result.previous.status,
          taskCategoryAppliedInputHash: result.previous.appliedInputHash,
          taskCategoryRequestedInputHash: result.previous.requestedInputHash,
          taskCategoryTaxonomyVersion: result.previous.taxonomyVersion,
          taskCategoryUpdatedAt: result.previousUpdatedAt,
        })
        .where(
          and(
            eq(entities.teamId, scope.teamId),
            eq(entities.id, taskId),
            eq(entities.type, 'task'),
            eq(entities.taskCategoryMode, 'automatic'),
            eq(entities.taskCategoryStatus, 'pending'),
            eq(entities.taskCategoryRequestedInputHash, result.inputHash),
            result.object.taskCategoryUpdatedAt
              ? eq(entities.taskCategoryUpdatedAt, result.object.taskCategoryUpdatedAt)
              : isNull(entities.taskCategoryUpdatedAt),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        )
        .returning({ id: entities.id });
      if (restored && result.previous.mode !== 'automatic') {
        await tx.insert(objectChanges).values({
          teamId: scope.teamId,
          entityId: taskId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          status: 'applied',
          field: 'taskCategoryMode',
          previousValue: 'automatic',
          newValue: result.previous.mode,
          sourceEventId: null,
        });
      }
    });
    throw error;
  }
  return { object: result.object, inputHash: result.inputHash };
}

export function resetTaskCategoryToAutomatic(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
) {
  return transitionTaskCategoryToPending(db, scope, taskId, actor, false, 'context_change');
}

export function retryTaskCategory(
  db: Db,
  scope: TeamScopeCore,
  taskId: string,
  actor: UpdateActor,
) {
  return transitionTaskCategoryToPending(db, scope, taskId, actor, true, 'retry');
}

export function enqueueTaskCategoryBackfill(db: Db, scope: TeamScopeCore, taskId: string) {
  return transitionTaskCategoryToPending(
    db,
    scope,
    taskId,
    { kind: 'agent', userId: null },
    false,
    'backfill',
  );
}

export async function applyTaskCategoryClassification(
  db: Db,
  scope: TeamScopeCore,
  input: {
    taskId: string;
    inputHash: string;
    category: TaskCategory;
    confidence: number;
    model: string;
    latencyMs: number;
  },
): Promise<'applied' | 'discarded_stale' | 'discarded_human_override'> {
  await scope.requireMembership();
  const category = taskCategorySchema.parse(input.category);
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)))
      .for('update')
      .limit(1);
    const applicable =
      task?.type === 'task' &&
      !task.archivedAt &&
      !task.mergedIntoId &&
      task.taskCategoryMode === 'automatic' &&
      task.taskCategoryRequestedInputHash === input.inputHash;
    if (!task) return 'discarded_stale';
    const outcome = applicable
      ? 'applied'
      : task.taskCategoryMode === 'manual'
        ? 'discarded_human_override'
        : 'discarded_stale';
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: input.taskId,
      category,
      source: 'llm',
      mode: 'automatic',
      confidence: input.confidence,
      model: input.model,
      promptVersion: TASK_CATEGORY_PROMPT_VERSION,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      inputHash: input.inputHash,
      outcome,
      latencyMs: input.latencyMs,
    });
    if (!applicable) return outcome;
    await tx
      .update(entities)
      .set({
        taskCategory: category,
        taskCategoryMode: 'automatic',
        taskCategorySource: 'llm',
        taskCategoryStatus: 'ready',
        taskCategoryAppliedInputHash: input.inputHash,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
        taskCategoryUpdatedAt: new Date(),
      })
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)));
    if (task.taskCategory !== category) {
      await tx.insert(objectChanges).values({
        teamId: scope.teamId,
        entityId: input.taskId,
        actorUserId: null,
        actorKind: 'agent',
        status: 'applied',
        field: 'taskCategory',
        previousValue: task.taskCategory,
        newValue: category,
        sourceEventId: null,
      });
    }
    return outcome;
  });
}

export async function failTaskCategoryClassification(
  db: Db,
  scope: TeamScopeCore,
  input: {
    taskId: string;
    inputHash: string;
    model: string;
    failureCode: string;
    latencyMs: number;
  },
): Promise<'failed' | 'discarded_stale' | 'discarded_human_override'> {
  await scope.requireMembership();
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(entities)
      .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)))
      .for('update')
      .limit(1);
    const applicable =
      task?.type === 'task' &&
      !task.archivedAt &&
      !task.mergedIntoId &&
      task.taskCategoryMode === 'automatic' &&
      task.taskCategoryRequestedInputHash === input.inputHash;
    if (!task) return 'discarded_stale';
    const outcome = applicable
      ? 'failed'
      : task.taskCategoryMode === 'manual'
        ? 'discarded_human_override'
        : 'discarded_stale';
    await tx.insert(taskCategoryAssignments).values({
      teamId: scope.teamId,
      entityId: input.taskId,
      category: null,
      source: 'llm',
      mode: 'automatic',
      model: input.model,
      promptVersion: TASK_CATEGORY_PROMPT_VERSION,
      taxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      inputHash: input.inputHash,
      outcome,
      failureCode: input.failureCode.slice(0, 120),
      latencyMs: input.latencyMs,
    });
    if (applicable) {
      await tx
        .update(entities)
        .set({
          taskCategoryStatus: 'failed',
          taskCategoryRequestedInputHash: null,
          taskCategoryUpdatedAt: new Date(),
        })
        .where(and(eq(entities.teamId, scope.teamId), eq(entities.id, input.taskId)));
    }
    return outcome;
  });
}
