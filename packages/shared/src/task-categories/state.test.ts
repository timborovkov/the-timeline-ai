/**
 * Business intent: category authority and a task's primary project remain
 * team-scoped, singular, auditable, and safe under stale LLM responses.
 */
import {
  entities,
  entityRelationships,
  objectChanges,
  taskCategoryAssignments,
  taskCategoryProjectInvalidations,
  type Db,
} from '@timeline/db';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import * as queue from '#src/queue/queues.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

vi.mock('#src/queue/queues.js', () => ({
  enqueueObjectEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueEntityEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectChangeEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueCalendarEventEmbedJob: vi.fn().mockResolvedValue(undefined),
  enqueueObjectSummaryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'summary' }),
  enqueueTaskCategoryJob: vi.fn().mockResolvedValue({ enqueued: true, jobId: 'category' }),
}));

const TEAM_A = '11111111-1111-1111-1111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGINAL_ENV = { ...process.env };

let testDb: ResettablePGliteTestDb;
let db: Db;

beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`
      INSERT INTO teams (id, slug, name) VALUES
        ('${TEAM_A}', 'category-a', 'Category A'),
        ('${TEAM_B}', 'category-b', 'Category B');
      INSERT INTO users (id, email) VALUES
        ('${USER_A}', 'category-a@test.local'),
        ('${USER_B}', 'category-b@test.local');
      INSERT INTO team_members (team_id, user_id, role) VALUES
        ('${TEAM_A}', '${USER_A}', 'owner'),
        ('${TEAM_B}', '${USER_B}', 'owner');
    `);
  });
  db = drizzle(testDb.pg) as unknown as Db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'true';
  process.env.TASK_CATEGORY_AUTO_ENQUEUE_ENABLED = 'true';
  process.env.TASK_CATEGORY_BACKFILL_ENABLED = 'true';
  process.env.TASK_CATEGORY_WORKER_ENABLED = 'true';
  resetEnvForTests();
  await testDb.reset();
});

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvForTests();
  await testDb.close();
});

describe('task category and primary project state', () => {
  it('creates a pending automatic task with a durable, filterable primary project', async () => {
    const workspace = withTeam(db, TEAM_A, USER_A);
    const scope = workspace.objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      actor: { kind: 'user', userId: USER_A },
    });
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare homepage wireframes',
      parentObjectId: project.id,
      actor: { kind: 'user', userId: USER_A },
    });

    expect(task).toMatchObject({
      taskCategory: null,
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'pending',
    });
    const [relation] = await scope.listPrimaryProjectsForTasks([task.id]);
    expect(relation).toMatchObject({
      taskId: task.id,
      projectId: project.id,
      projectName: 'Faba website redesign',
    });
    await expect(
      scope.listObjects({ type: 'task', primaryProjectId: project.id }),
    ).resolves.toEqual([expect.objectContaining({ id: task.id })]);
    await expect(scope.listObjects({ taskCategoryNull: true })).resolves.toEqual([
      expect.objectContaining({ id: task.id, type: 'task' }),
    ]);
    const board = await workspace.boards.createBoard({
      name: 'Mixed work',
      templateKind: 'custom',
      lanes: [{ name: 'Open' }],
    });
    await workspace.boards.addBoardItem(board.id, {
      entityId: project.id,
      actor: { kind: 'user', userId: USER_A },
    });
    await workspace.boards.addBoardItem(board.id, {
      entityId: task.id,
      actor: { kind: 'user', userId: USER_A },
    });
    const filteredBoard = await workspace.boards.getBoard(board.id, {
      itemFilter: { object: { taskCategoryNull: true } },
    });
    expect(filteredBoard?.items.map((item) => item.entityId)).toEqual([task.id]);
  });

  it('locks an active project while assigning it to an existing task', async () => {
    const queries: string[] = [];
    const loggedDb = drizzle(testDb.pg, {
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    }) as unknown as Db;
    const scope = withTeam(loggedDb, TEAM_A, USER_A).objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Lifecycle-safe project',
      actor: { kind: 'user', userId: USER_A },
    });
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Lifecycle-safe task',
      actor: { kind: 'user', userId: USER_A },
    });
    queries.length = 0;

    await scope.setTaskProject(task.id, project.id, { kind: 'user', userId: USER_A });

    const projectRead = queries.find(
      (query) =>
        query.includes('"canonical_name"') &&
        query.includes('"archived_at"') &&
        query.includes('"type"') &&
        !query.includes('"task_category_mode"'),
    );
    expect(projectRead).toMatch(/for update/i);
    const relationshipRead = queries.find((query) =>
      query.includes('from "entity_relationships" inner join "entities"'),
    );
    expect(relationshipRead).toMatch(/for update of "entity_relationships"/i);
  });

  it('does not treat ambiguous legacy project edges as a primary project', async () => {
    const workspace = withTeam(db, TEAM_A, USER_A);
    const firstProject = await workspace.objects.createObject({
      type: 'project',
      canonicalName: 'First legacy project',
      actor: { kind: 'user', userId: USER_A },
    });
    const secondProject = await workspace.objects.createObject({
      type: 'project',
      canonicalName: 'Second legacy project',
      actor: { kind: 'user', userId: USER_A },
    });
    const task = await workspace.objects.createObject({
      type: 'task',
      canonicalName: 'Ambiguous legacy task',
      actor: { kind: 'user', userId: USER_A },
    });
    await db.insert(entityRelationships).values([
      {
        teamId: TEAM_A,
        fromEntityId: task.id,
        toEntityId: firstProject.id,
        kind: 'child',
        createdBy: USER_A,
      },
      {
        teamId: TEAM_A,
        fromEntityId: task.id,
        toEntityId: secondProject.id,
        kind: 'child',
        createdBy: USER_A,
      },
    ]);

    await expect(workspace.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([]);
    await expect(workspace.objects.auditTaskPrimaryProjectEdges()).resolves.toEqual({
      ambiguousTaskIds: [task.id],
      hasMore: false,
    });
    await expect(
      workspace.objects.listObjects({ type: 'task', primaryProjectId: firstProject.id }),
    ).resolves.toEqual([]);
    await expect(
      workspace.objects.listObjects({ type: 'task', primaryProjectId: secondProject.id }),
    ).resolves.toEqual([]);
    const board = await workspace.boards.createBoard({
      name: 'Legacy project board',
      templateKind: 'custom',
      lanes: [{ name: 'Open' }],
    });
    await workspace.boards.addBoardItem(board.id, {
      entityId: task.id,
      actor: { kind: 'user', userId: USER_A },
    });
    await expect(
      workspace.boards.getBoard(board.id, {
        itemFilter: { object: { primaryProjectId: firstProject.id } },
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      workspace.objects.getTaskCategoryClassificationInput(task.id),
    ).resolves.toMatchObject({ packet: { primaryProjectName: null } });

    await workspace.objects.updateObject(
      firstProject.id,
      { canonicalName: 'Renamed legacy project' },
      { kind: 'user', userId: USER_A },
    );
    const classification = await workspace.objects.getTaskCategoryClassificationInput(task.id);
    expect(classification).toMatchObject({ packet: { primaryProjectName: null } });
    expect(classification?.requestedInputHash).toBe(classification?.inputHash);
  });

  it('treats removing an absent primary project as a no-op', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Standalone task',
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(
      scope.setTaskProject(task.id, null, { kind: 'user', userId: USER_A }),
    ).resolves.toEqual({ changed: false, project: null, touchedIds: [] });
  });

  it('applies an LLM result without reordering the task, then protects a human override', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Implement checkout API',
      actor: { kind: 'user', userId: USER_A },
    });
    const input = await scope.getTaskCategoryClassificationInput(task.id);
    expect(input?.requestedInputHash).toEqual(expect.any(String));
    const updatedAt = task.updatedAt;
    await expect(
      scope.applyTaskCategoryClassification({
        taskId: task.id,
        inputHash: input?.requestedInputHash ?? '',
        category: 'engineering',
        confidence: 0.97,
        model: 'test-model',
        latencyMs: 12,
      }),
    ).resolves.toBe('applied');
    const [automatic] = await scope.listObjects({ id: task.id });
    expect(automatic).toMatchObject({
      taskCategory: 'engineering',
      taskCategoryMode: 'automatic',
      taskCategorySource: 'llm',
      taskCategoryStatus: 'ready',
      updatedAt,
    });

    await scope.resetTaskCategoryToAutomatic(task.id, { kind: 'user', userId: USER_A });
    const pending = await scope.getTaskCategoryClassificationInput(task.id);
    await scope.setTaskCategory(task.id, 'product', { kind: 'user', userId: USER_A });
    await expect(
      scope.applyTaskCategoryClassification({
        taskId: task.id,
        inputHash: pending?.requestedInputHash ?? '',
        category: 'engineering',
        confidence: 0.8,
        model: 'late-model',
        latencyMs: 50,
      }),
    ).resolves.toBe('discarded_human_override');
    const [manual] = await scope.listObjects({ id: task.id });
    expect(manual).toMatchObject({
      taskCategory: 'product',
      taskCategoryMode: 'manual',
      taskCategorySource: 'user',
    });

    const assignments = await db
      .select()
      .from(taskCategoryAssignments)
      .where(eq(taskCategoryAssignments.entityId, task.id));
    expect(assignments.map((row) => row.outcome)).toEqual([
      'applied',
      'applied',
      'discarded_human_override',
    ]);
    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, task.id));
    expect(changes.filter((row) => row.field === 'taskCategory')).toHaveLength(2);
  });

  it('preserves a ready category when an object edit does not change its classifier packet', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Implement checkout API',
      actor: { kind: 'user', userId: USER_A },
    });
    const input = await scope.getTaskCategoryClassificationInput(task.id);
    const inputHash = input?.requestedInputHash ?? '';
    await scope.applyTaskCategoryClassification({
      taskId: task.id,
      inputHash,
      category: 'engineering',
      confidence: 0.97,
      model: 'test-model',
      latencyMs: 12,
    });
    vi.mocked(queue.enqueueTaskCategoryJob).mockClear();

    const result = await scope.updateObject(
      task.id,
      { metadata: { sync_cursor: 'cursor-2' } },
      { kind: 'user', userId: USER_A },
    );

    expect(result.object).toMatchObject({
      taskCategory: 'engineering',
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'ready',
    });
    const [persisted] = await db.select().from(entities).where(eq(entities.id, task.id));
    expect(persisted).toMatchObject({
      taskCategoryAppliedInputHash: inputHash,
      taskCategoryRequestedInputHash: null,
    });
    expect(queue.enqueueTaskCategoryJob).not.toHaveBeenCalled();
  });

  it('combines a selected category with uncategorized tasks in one DB filter', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const categorized = await scope.createObject({
      type: 'task',
      canonicalName: 'Implement checkout API',
      actor: { kind: 'user', userId: USER_A },
    });
    const uncategorized = await scope.createObject({
      type: 'task',
      canonicalName: 'Clarify launch scope',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.setTaskCategory(categorized.id, 'engineering', {
      kind: 'user',
      userId: USER_A,
    });

    await expect(
      scope.listObjects({
        type: 'task',
        taskCategory: 'engineering',
        taskCategoryNull: true,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: uncategorized.id, taskCategory: null }),
        expect.objectContaining({ id: categorized.id, taskCategory: 'engineering' }),
      ]),
    );
  });

  it('can reapply an automatic result when unchanged context returns to an earlier hash', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare launch plan',
      actor: { kind: 'user', userId: USER_A },
    });
    const firstInput = await scope.getTaskCategoryClassificationInput(task.id);
    const inputHash = firstInput?.requestedInputHash ?? '';
    await scope.applyTaskCategoryClassification({
      taskId: task.id,
      inputHash,
      category: 'marketing',
      confidence: 0.9,
      model: 'test-model',
      latencyMs: 10,
    });
    await scope.setTaskCategory(task.id, 'strategy_planning', {
      kind: 'user',
      userId: USER_A,
    });
    await scope.resetTaskCategoryToAutomatic(task.id, { kind: 'user', userId: USER_A });
    const secondInput = await scope.getTaskCategoryClassificationInput(task.id);
    expect(secondInput?.requestedInputHash).toBe(inputHash);

    await expect(
      scope.applyTaskCategoryClassification({
        taskId: task.id,
        inputHash,
        category: 'marketing',
        confidence: 0.92,
        model: 'test-model',
        latencyMs: 11,
      }),
    ).resolves.toBe('applied');
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({
        taskCategory: 'marketing',
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'ready',
      }),
    ]);
    const applied = await db
      .select()
      .from(taskCategoryAssignments)
      .where(eq(taskCategoryAssignments.entityId, task.id));
    expect(
      applied.filter((row) => row.outcome === 'applied' && row.inputHash === inputHash),
    ).toHaveLength(2);
  });

  it('refreshes a drifted pending request without overriding a concurrent manual category', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Repair category packet',
      actor: { kind: 'user', userId: USER_A },
    });
    const current = await scope.getTaskCategoryClassificationInput(task.id);
    const staleHash = 'a'.repeat(64);
    await db
      .update(entities)
      .set({ taskCategoryRequestedInputHash: staleHash })
      .where(eq(entities.id, task.id));

    await expect(
      scope.refreshTaskCategoryClassificationRequest(task.id, staleHash),
    ).resolves.toMatchObject({ inputHash: current?.inputHash });
    await expect(scope.getTaskCategoryClassificationInput(task.id)).resolves.toMatchObject({
      requestedInputHash: current?.inputHash,
    });

    await scope.setTaskCategory(task.id, 'engineering', { kind: 'user', userId: USER_A });
    await expect(
      scope.refreshTaskCategoryClassificationRequest(task.id, current?.inputHash ?? ''),
    ).resolves.toBeNull();
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({ taskCategory: 'engineering', taskCategoryMode: 'manual' }),
    ]);
  });

  it('preserves a manual category when automatic classification is unavailable', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Keep the manual category',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.setTaskCategory(task.id, 'design', { kind: 'user', userId: USER_A });
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'false';
    resetEnvForTests();

    await expect(
      scope.resetTaskCategoryToAutomatic(task.id, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('Automatic task categorization is unavailable');
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({
        taskCategory: 'design',
        taskCategoryMode: 'manual',
        taskCategoryStatus: 'ready',
      }),
    ]);
  });

  it('undoes a manual correction by restoring the prior value and authority without deleting history', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Implement the billing API',
      actor: { kind: 'user', userId: USER_A },
    });
    const input = await scope.getTaskCategoryClassificationInput(task.id);
    await scope.applyTaskCategoryClassification({
      taskId: task.id,
      inputHash: input?.requestedInputHash ?? '',
      category: 'engineering',
      confidence: 0.9,
      model: 'test-model',
      latencyMs: 10,
    });

    const correction = await scope.setTaskCategory(task.id, 'finance', {
      kind: 'user',
      userId: USER_A,
    });
    await expect(
      scope.undoTaskCategoryChange(task.id, correction.changeId, {
        kind: 'user',
        userId: USER_A,
      }),
    ).resolves.toMatchObject({
      taskCategory: 'engineering',
      taskCategoryMode: 'automatic',
      taskCategorySource: 'llm',
      taskCategoryStatus: 'ready',
    });
    const changes = await db
      .select()
      .from(objectChanges)
      .where(eq(objectChanges.entityId, task.id));
    expect(changes.filter((row) => row.field === 'taskCategory')).toHaveLength(3);

    const newer = await scope.setTaskCategory(task.id, 'product', {
      kind: 'user',
      userId: USER_A,
    });
    await scope.setTaskCategory(task.id, 'design', { kind: 'user', userId: USER_A });
    await expect(
      scope.undoTaskCategoryChange(task.id, newer.changeId, {
        kind: 'user',
        userId: USER_A,
      }),
    ).rejects.toThrow('stale');
  });

  it('re-enqueues when undo restores a pending automatic snapshot', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Classify this later',
      actor: { kind: 'user', userId: USER_A },
    });
    const pending = await scope.getTaskCategoryClassificationInput(task.id);
    const correction = await scope.setTaskCategory(task.id, 'product', {
      kind: 'user',
      userId: USER_A,
    });
    vi.mocked(queue.enqueueTaskCategoryJob).mockClear();

    await scope.undoTaskCategoryChange(task.id, correction.changeId, {
      kind: 'user',
      userId: USER_A,
    });

    expect(queue.enqueueTaskCategoryJob).toHaveBeenCalledWith({
      teamId: TEAM_A,
      taskId: task.id,
      inputHash: pending?.requestedInputHash,
      trigger: 'retry',
    });
  });

  it('preserves a manual category when undo cannot restore pending automation', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Classify this when automation returns',
      actor: { kind: 'user', userId: USER_A },
    });
    const correction = await scope.setTaskCategory(task.id, 'product', {
      kind: 'user',
      userId: USER_A,
    });
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'false';
    resetEnvForTests();

    await expect(
      scope.undoTaskCategoryChange(task.id, correction.changeId, {
        kind: 'user',
        userId: USER_A,
      }),
    ).rejects.toThrow('Automatic task categorization is unavailable');
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({
        taskCategory: 'product',
        taskCategoryMode: 'manual',
        taskCategoryStatus: 'ready',
      }),
    ]);
  });

  it('restores failed automatic state when an explicit retry cannot reach the queue', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Retry category safely',
      actor: { kind: 'user', userId: USER_A },
    });
    const input = await scope.getTaskCategoryClassificationInput(task.id);
    if (!input) throw new Error('Expected pending category input');
    await scope.failTaskCategoryClassification({
      taskId: task.id,
      inputHash: input.inputHash,
      model: 'test-model',
      failureCode: 'test_failure',
      latencyMs: 10,
    });
    vi.mocked(queue.enqueueTaskCategoryJob).mockRejectedValueOnce(new Error('redis down'));

    await expect(
      scope.retryTaskCategory(task.id, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('redis down');
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'failed',
      }),
    ]);
    await expect(scope.getTaskCategoryClassificationInput(task.id)).resolves.toBeNull();
  });

  it('recomputes a restored pending hash when task context changed during a manual override', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Classify the original title',
      actor: { kind: 'user', userId: USER_A },
    });
    const original = await scope.getTaskCategoryClassificationInput(task.id);
    const correction = await scope.setTaskCategory(task.id, 'product', {
      kind: 'user',
      userId: USER_A,
    });
    await scope.updateObject(
      task.id,
      { canonicalName: 'Classify the updated title' },
      { kind: 'user', userId: USER_A },
    );
    vi.mocked(queue.enqueueTaskCategoryJob).mockClear();

    await scope.undoTaskCategoryChange(task.id, correction.changeId, {
      kind: 'user',
      userId: USER_A,
    });

    const restored = await scope.getTaskCategoryClassificationInput(task.id);
    expect(restored?.requestedInputHash).toBe(restored?.inputHash);
    expect(restored?.requestedInputHash).not.toBe(original?.requestedInputHash);
    expect(queue.enqueueTaskCategoryJob).toHaveBeenCalledWith({
      teamId: TEAM_A,
      taskId: task.id,
      inputHash: restored?.requestedInputHash,
      trigger: 'retry',
    });
  });

  it('does not hydrate a generic non-task child edge as a primary project', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const company = await scope.createObject({
      type: 'company',
      canonicalName: 'Faba',
      actor: { kind: 'user', userId: USER_A },
    });
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.addRelationship({
      fromEntityId: company.id,
      toEntityId: project.id,
      kind: 'child',
      actorUserId: USER_A,
    });

    await expect(scope.listPrimaryProjectsForTasks([company.id])).resolves.toEqual([]);
  });

  it('keeps committed category state when the Redis handoff fails', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Original title',
      actor: { kind: 'user', userId: USER_A },
    });
    vi.mocked(queue.enqueueTaskCategoryJob).mockRejectedValueOnce(new Error('redis down'));

    await expect(
      scope.updateObject(
        task.id,
        { canonicalName: 'Updated title' },
        { kind: 'user', userId: USER_A },
      ),
    ).resolves.toMatchObject({ object: { canonicalName: 'Updated title' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [persisted] = await scope.listObjects({ id: task.id });
    expect(persisted).toMatchObject({
      canonicalName: 'Updated title',
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'pending',
    });
  });

  it('replaces only project child edges and blocks generic relationship bypasses', async () => {
    const workspace = withTeam(db, TEAM_A, USER_A);
    const first = await workspace.objects.createObject({
      type: 'project',
      canonicalName: 'First project',
      actor: { kind: 'user', userId: USER_A },
    });
    const second = await workspace.objects.createObject({
      type: 'project',
      canonicalName: 'Second project',
      actor: { kind: 'user', userId: USER_A },
    });
    const company = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'Faba',
      actor: { kind: 'user', userId: USER_A },
    });
    const task = await workspace.objects.createObject({
      type: 'task',
      canonicalName: 'Review wireframes',
      parentObjectId: first.id,
      actor: { kind: 'user', userId: USER_A },
    });
    await db.insert(entityRelationships).values({
      teamId: TEAM_A,
      fromEntityId: task.id,
      toEntityId: company.id,
      kind: 'child',
      createdBy: USER_A,
    });

    await workspace.objects.setTaskProject(task.id, second.id, {
      kind: 'user',
      userId: USER_A,
    });
    await expect(workspace.objects.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ projectId: second.id }),
    ]);
    const edges = await db
      .select()
      .from(entityRelationships)
      .where(eq(entityRelationships.fromEntityId, task.id));
    expect(edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ toEntityId: company.id, kind: 'child' })]),
    );
    await expect(
      workspace.objects.addRelationship({
        fromEntityId: task.id,
        toEntityId: first.id,
        kind: 'child',
        actorUserId: USER_A,
      }),
    ).rejects.toThrow('Project field');
    const projectEdge = edges.find((edge) => edge.toEntityId === second.id);
    await expect(
      workspace.objects.removeRelationship(projectEdge?.id ?? '', {
        kind: 'user',
        userId: USER_A,
      }),
    ).rejects.toThrow('Project field');
  });

  it('does not let legacy child edges make non-tasks match primary-project filters', async () => {
    const workspace = withTeam(db, TEAM_A, USER_A);
    const project = await workspace.objects.createObject({
      type: 'project',
      canonicalName: 'Faba redesign',
      actor: { kind: 'user', userId: USER_A },
    });
    const company = await workspace.objects.createObject({
      type: 'company',
      canonicalName: 'Legacy child',
      actor: { kind: 'user', userId: USER_A },
    });
    await db.insert(entityRelationships).values({
      teamId: TEAM_A,
      fromEntityId: company.id,
      toEntityId: project.id,
      kind: 'child',
      createdBy: USER_A,
    });
    const board = await workspace.boards.createBoard({
      name: 'Legacy relations',
      templateKind: 'custom',
      lanes: [{ name: 'Open' }],
    });
    await workspace.boards.addBoardItem(board.id, {
      entityId: company.id,
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(workspace.objects.listObjects({ primaryProjectId: project.id })).resolves.toEqual(
      [],
    );
    await expect(
      workspace.boards.getBoard(board.id, {
        itemFilter: { object: { primaryProjectId: project.id } },
      }),
    ).resolves.toMatchObject({ items: [] });
  });

  it('rejects archived, wrong-type, and cross-team project writes', async () => {
    const scopeA = withTeam(db, TEAM_A, USER_A).objects;
    const scopeB = withTeam(db, TEAM_B, USER_B).objects;
    const task = await scopeA.createObject({
      type: 'task',
      canonicalName: 'Scoped task',
      actor: { kind: 'user', userId: USER_A },
    });
    const company = await scopeA.createObject({
      type: 'company',
      canonicalName: 'Not a project',
      actor: { kind: 'user', userId: USER_A },
    });
    const archived = await scopeA.createObject({
      type: 'project',
      canonicalName: 'Archived project',
      actor: { kind: 'user', userId: USER_A },
    });
    await scopeA.archiveObject(archived.id, { kind: 'user', userId: USER_A });
    const foreign = await scopeB.createObject({
      type: 'project',
      canonicalName: 'Foreign project',
      actor: { kind: 'user', userId: USER_B },
    });

    await expect(
      scopeA.setTaskProject(task.id, company.id, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('Project not found');
    await expect(
      scopeA.setTaskProject(task.id, archived.id, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('Project not found');
    await expect(
      scopeA.setTaskProject(task.id, foreign.id, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('Project not found');
    const [row] = await db.select().from(entities).where(eq(entities.id, task.id));
    expect(row?.teamId).toBe(TEAM_A);
  });

  it('invalidates automatic tasks on project rename while preserving manual authority', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Faba redesign',
      actor: { kind: 'user', userId: USER_A },
    });
    const automatic = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare first draft',
      parentObjectId: project.id,
      actor: { kind: 'user', userId: USER_A },
    });
    const manual = await scope.createObject({
      type: 'task',
      canonicalName: 'Review contract',
      parentObjectId: project.id,
      actor: { kind: 'user', userId: USER_A },
    });
    await scope.setTaskCategory(manual.id, 'legal_compliance', {
      kind: 'user',
      userId: USER_A,
    });
    const before = await scope.getTaskCategoryClassificationInput(automatic.id);

    await scope.updateObject(
      project.id,
      { canonicalName: 'Faba website redesign' },
      { kind: 'user', userId: USER_A },
    );
    const after = await scope.getTaskCategoryClassificationInput(automatic.id);
    expect(after?.requestedInputHash).not.toBe(before?.requestedInputHash);
    const [manualAfter] = await scope.listObjects({ id: manual.id });
    expect(manualAfter).toMatchObject({
      taskCategory: 'legal_compliance',
      taskCategoryMode: 'manual',
      taskCategoryStatus: 'ready',
    });
    await expect(
      scope.updateObject(project.id, { type: 'company' }, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow('linked task projects');

    await scope.archiveObject(project.id, { kind: 'user', userId: USER_A });
    const [hydrated] = await scope.listPrimaryProjectsForTasks([automatic.id]);
    expect(hydrated?.archivedAt).toBeInstanceOf(Date);
    await expect(
      scope.listObjects({ type: 'task', primaryProjectId: project.id }),
    ).resolves.toHaveLength(2);
  });

  it('persists project invalidation work beyond the first page when queue handoff fails', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const project = await scope.createObject({
      type: 'project',
      canonicalName: 'Large client rollout',
      actor: { kind: 'user', userId: USER_A },
    });
    const taskIds = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    await db.insert(entities).values(
      taskIds.map((id, index) => ({
        id,
        teamId: TEAM_A,
        type: 'task' as const,
        canonicalName: `Rollout task ${String(index + 1)}`,
        status: 'todo',
        taskCategory: 'operations',
        taskCategoryMode: 'automatic',
        taskCategorySource: 'llm',
        taskCategoryStatus: 'ready',
        taskCategoryAppliedInputHash: `old-${String(index + 1)}`,
        taskCategoryTaxonomyVersion: 'task-categories-v1',
        taskCategoryUpdatedAt: new Date(),
      })),
    );
    await db.insert(entityRelationships).values(
      taskIds.map((taskId) => ({
        teamId: TEAM_A,
        fromEntityId: taskId,
        toEntityId: project.id,
        kind: 'child' as const,
        createdBy: USER_A,
      })),
    );
    vi.mocked(queue.enqueueTaskCategoryJob).mockRejectedValue(new Error('redis down'));

    await scope.updateObject(
      project.id,
      { canonicalName: 'Large client launch' },
      { kind: 'user', userId: USER_A },
    );

    const [invalidation] = await db.select().from(taskCategoryProjectInvalidations);
    expect(invalidation).toMatchObject({
      teamId: TEAM_A,
      projectId: project.id,
      afterTaskId: taskIds[499],
    });

    await expect(
      scope.invalidateTaskCategoriesForProject({
        projectId: project.id,
        projectVersion: invalidation?.projectVersion ?? '',
        afterTaskId: invalidation?.afterTaskId ?? null,
      }),
    ).resolves.toEqual({
      jobs: [expect.objectContaining({ taskId: taskIds[500] })],
      nextCursor: null,
    });
    await expect(db.select().from(taskCategoryProjectInvalidations)).resolves.toEqual([]);
  });

  it('initializes and clears category state across task type changes', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const object = await scope.createObject({
      type: 'other',
      canonicalName: 'Promoted work item',
      actor: { kind: 'user', userId: USER_A },
    });
    const promoted = await scope.updateObject(
      object.id,
      { type: 'task' },
      { kind: 'user', userId: USER_A },
    );
    expect(promoted.object).toMatchObject({
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'pending',
    });
    const demoted = await scope.updateObject(
      object.id,
      { type: 'other' },
      { kind: 'user', userId: USER_A },
    );
    expect(demoted.object).toMatchObject({
      taskCategory: null,
      taskCategoryMode: null,
      taskCategoryStatus: null,
    });
  });

  it('restores a backfill candidate when the queue handoff fails', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Backfill handoff candidate',
      actor: { kind: 'user', userId: USER_A },
    });
    await db
      .update(entities)
      .set({
        taskCategoryMode: 'automatic',
        taskCategoryStatus: 'failed',
        taskCategoryRequestedInputHash: null,
      })
      .where(eq(entities.id, task.id));
    vi.mocked(queue.enqueueTaskCategoryJob).mockRejectedValueOnce(new Error('redis down'));

    await expect(scope.enqueueTaskCategoryBackfill(task.id)).rejects.toThrow('redis down');

    const [restored] = await scope.listObjects({ id: task.id });
    expect(restored).toMatchObject({
      taskCategoryMode: 'automatic',
      taskCategoryStatus: 'failed',
    });
  });

  it('does not let a stale backfill candidate replace a manual category', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Manual category wins over backfill',
      actor: { kind: 'user', userId: USER_A },
    });
    await db
      .update(entities)
      .set({
        taskCategoryStatus: 'failed',
        taskCategoryRequestedInputHash: null,
      })
      .where(eq(entities.id, task.id));
    await scope.setTaskCategory(task.id, 'legal_compliance', {
      kind: 'user',
      userId: USER_A,
    });
    vi.mocked(queue.enqueueTaskCategoryJob).mockClear();

    await expect(scope.enqueueTaskCategoryBackfill(task.id)).rejects.toThrow(
      'Task is no longer eligible for category backfill',
    );
    await expect(scope.listObjects({ id: task.id })).resolves.toEqual([
      expect.objectContaining({
        taskCategory: 'legal_compliance',
        taskCategoryMode: 'manual',
        taskCategoryStatus: 'ready',
      }),
    ]);
    expect(queue.enqueueTaskCategoryJob).not.toHaveBeenCalled();
  });

  it('records a compensating mode change when a historical backfill handoff fails', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Historical backfill candidate',
      actor: { kind: 'user', userId: USER_A },
    });
    await db
      .update(entities)
      .set({
        taskCategory: null,
        taskCategoryMode: null,
        taskCategorySource: null,
        taskCategoryStatus: null,
        taskCategoryAppliedInputHash: null,
        taskCategoryRequestedInputHash: null,
        taskCategoryTaxonomyVersion: null,
        taskCategoryUpdatedAt: null,
      })
      .where(eq(entities.id, task.id));
    vi.mocked(queue.enqueueTaskCategoryJob).mockRejectedValueOnce(new Error('redis down'));

    await expect(scope.enqueueTaskCategoryBackfill(task.id)).rejects.toThrow('redis down');

    const modeChanges = await db
      .select({
        previousValue: objectChanges.previousValue,
        newValue: objectChanges.newValue,
      })
      .from(objectChanges)
      .where(and(eq(objectChanges.entityId, task.id), eq(objectChanges.field, 'taskCategoryMode')))
      .orderBy(asc(objectChanges.changedAt), asc(objectChanges.id));
    expect(modeChanges).toEqual([
      { previousValue: null, newValue: 'automatic' },
      { previousValue: 'automatic', newValue: null },
    ]);
  });

  it('rejects promotion when generic child edges would create ambiguous primary projects', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const [firstProject, secondProject, object] = await Promise.all([
      scope.createObject({
        type: 'project',
        canonicalName: 'First project',
        actor: { kind: 'user', userId: USER_A },
      }),
      scope.createObject({
        type: 'project',
        canonicalName: 'Second project',
        actor: { kind: 'user', userId: USER_A },
      }),
      scope.createObject({
        type: 'other',
        canonicalName: 'Generic work item',
        actor: { kind: 'user', userId: USER_A },
      }),
    ]);
    for (const project of [firstProject, secondProject]) {
      await scope.addRelationship({
        fromEntityId: object.id,
        toEntityId: project.id,
        kind: 'child',
        actorUserId: USER_A,
      });
    }

    await expect(
      scope.updateObject(object.id, { type: 'task' }, { kind: 'user', userId: USER_A }),
    ).rejects.toThrow(
      'Resolve multiple project relationships before changing this object to a task',
    );
  });

  it('retargets primary project edges and invalidates automatic context on project merge', async () => {
    const scope = withTeam(db, TEAM_A, USER_A).objects;
    const survivor = await scope.createObject({
      type: 'project',
      canonicalName: 'Faba website redesign',
      actor: { kind: 'user', userId: USER_A },
    });
    const duplicate = await scope.createObject({
      type: 'project',
      canonicalName: 'Faba redesign duplicate',
      actor: { kind: 'user', userId: USER_A },
    });
    const task = await scope.createObject({
      type: 'task',
      canonicalName: 'Prepare first draft',
      parentObjectId: duplicate.id,
      actor: { kind: 'user', userId: USER_A },
    });
    const before = await scope.getTaskCategoryClassificationInput(task.id);

    await scope.mergeObjects({
      survivorId: survivor.id,
      mergedIds: [duplicate.id],
      actor: { kind: 'user', userId: USER_A },
    });

    await expect(scope.listPrimaryProjectsForTasks([task.id])).resolves.toEqual([
      expect.objectContaining({ projectId: survivor.id, projectName: 'Faba website redesign' }),
    ]);
    const after = await scope.getTaskCategoryClassificationInput(task.id);
    expect(after?.requestedInputHash).not.toBe(before?.requestedInputHash);
  });
});
