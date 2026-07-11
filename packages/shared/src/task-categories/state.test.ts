/**
 * Business intent: category authority and a task's primary project remain
 * team-scoped, singular, auditable, and safe under stale LLM responses.
 */
import {
  entities,
  entityRelationships,
  objectChanges,
  taskCategoryAssignments,
  type Db,
} from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  await testDb.reset();
});

afterAll(async () => testDb.close());

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
