/** Business intent: the worker classifies only the exact pending task packet and applies it once. */
import { resetEnvForTests } from '@timeline/shared/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  withTeam: vi.fn(),
  getInput: vi.fn(),
  refreshRequest: vi.fn(),
  apply: vi.fn(),
  invalidateProject: vi.fn(),
  enqueue: vi.fn(),
  worker: vi.fn(),
}));

vi.mock('@timeline/shared', () => ({
  llm: { TIMELINE_MODELS: { taskCategorization: { id: 'test-model' } } },
  queue: {
    QUEUE_NAMES: { taskCategory: 'task-category' },
    getRedisConnection: vi.fn(),
    enqueueTaskCategoryJob: fakes.enqueue,
  },
}));
vi.mock('@timeline/shared/task-categories', () => ({ classifyTaskCategory: vi.fn() }));
vi.mock('@timeline/shared/team-scope', () => ({ withTeam: fakes.withTeam }));
vi.mock('bullmq', () => ({
  Worker: class Worker {
    on = vi.fn();

    constructor(...args: unknown[]) {
      fakes.worker(...args);
    }
  },
  DelayedError: class DelayedError extends Error {},
}));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));

const { processTaskCategoryJobForTests, startTaskCategoryWorker } =
  await import('#src/workers/taskCategory.js');

const JOB = {
  teamId: 'team-1',
  taskId: 'task-1',
  inputHash: 'hash-1',
  trigger: 'create' as const,
};

describe('task category worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.withTeam.mockReturnValue({
      objects: {
        getTaskCategoryClassificationInput: fakes.getInput,
        refreshTaskCategoryClassificationRequest: fakes.refreshRequest,
        applyTaskCategoryClassification: fakes.apply,
        invalidateTaskCategoriesForProject: fakes.invalidateProject,
      },
    });
  });

  it('does not register a queue consumer while classification or worker consumption is disabled', () => {
    process.env.TASK_CATEGORY_CLASSIFICATION_ENABLED = 'false';
    process.env.TASK_CATEGORY_WORKER_ENABLED = 'false';
    resetEnvForTests();

    expect(startTaskCategoryWorker({ db: {} as never })).toBeNull();
    expect(fakes.worker).not.toHaveBeenCalled();
  });

  it('skips rows that are no longer pending', async () => {
    fakes.getInput.mockResolvedValue(null);
    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, { enabled: true }),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'not_pending',
    });
    expect(fakes.apply).not.toHaveBeenCalled();
  });

  it('skips stale jobs and repairs packet drift without calling the model', async () => {
    const classify = vi.fn();
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-2',
      inputHash: 'hash-2',
    });
    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, { classify, enabled: true }),
    ).resolves.toMatchObject({ reason: 'stale_job' });

    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-new-context',
    });
    fakes.refreshRequest.mockResolvedValue({
      packet: { title: 'Build API in new context' },
      inputHash: 'hash-new-context',
    });
    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, { classify, enabled: true }),
    ).resolves.toEqual({ status: 'refreshed_packet' });
    expect(fakes.refreshRequest).toHaveBeenCalledWith('task-1', 'hash-1');
    expect(fakes.enqueue).toHaveBeenCalledWith({
      teamId: 'team-1',
      taskId: 'task-1',
      inputHash: 'hash-new-context',
      trigger: 'retry',
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it('classifies the locked packet when context returns to the queued hash', async () => {
    const classify = vi.fn().mockResolvedValue({
      category: 'engineering',
      confidence: 0.9,
      model: 'served-model',
    });
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API in transient context' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-transient-context',
    });
    fakes.refreshRequest.mockResolvedValue({
      packet: { title: 'Build API' },
      inputHash: 'hash-1',
    });
    fakes.apply.mockResolvedValue('applied');

    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, { classify, enabled: true }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(classify).toHaveBeenCalledWith({ title: 'Build API' });
    expect(fakes.enqueue).not.toHaveBeenCalled();
  });

  it('does not repair packet drift after a concurrent authority change', async () => {
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-new-context',
    });
    fakes.refreshRequest.mockResolvedValue(null);

    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, { enabled: true }),
    ).resolves.toEqual({ status: 'skipped', reason: 'stale_job' });
    expect(fakes.enqueue).not.toHaveBeenCalled();
  });

  it('passes model attribution and measured latency into the guarded apply', async () => {
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-1',
    });
    const classify = vi.fn().mockResolvedValue({
      category: 'engineering',
      confidence: 0.9,
      model: 'served-model',
    });
    fakes.apply.mockResolvedValue('applied');
    const times = [100, 125];

    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, {
        classify,
        enabled: true,
        now: () => times.shift() ?? 125,
      }),
    ).resolves.toMatchObject({ status: 'applied' });
    expect(fakes.apply).toHaveBeenCalledWith({
      taskId: 'task-1',
      inputHash: 'hash-1',
      category: 'engineering',
      confidence: 0.9,
      model: 'served-model',
      latencyMs: 25,
    });
  });

  it('pages bounded project fan-out and schedules classification plus the next cursor', async () => {
    fakes.invalidateProject.mockResolvedValue({
      jobs: [{ taskId: 'task-501', inputHash: 'hash-501' }],
      nextCursor: 'task-501',
    });
    const fanout = {
      kind: 'project_fanout' as const,
      teamId: 'team-1',
      projectId: 'project-1',
      projectVersion: 'version-1',
      afterTaskId: 'task-500',
    };

    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, fanout, { enabled: true }),
    ).resolves.toEqual({
      status: 'fanout',
      count: 1,
    });
    expect(fakes.invalidateProject).toHaveBeenCalledWith({
      projectId: 'project-1',
      projectVersion: 'version-1',
      afterTaskId: 'task-500',
    });
    expect(fakes.enqueue).toHaveBeenNthCalledWith(1, {
      teamId: 'team-1',
      taskId: 'task-501',
      inputHash: 'hash-501',
      trigger: 'project_change',
    });
    expect(fakes.enqueue).toHaveBeenNthCalledWith(2, {
      ...fanout,
      afterTaskId: 'task-501',
    });
  });

  it('acquires a team permit before spending a model call', async () => {
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-1',
    });
    const acquireTeamPermit = vi.fn().mockResolvedValue(null);
    const classify = vi.fn().mockResolvedValue({
      category: 'engineering',
      confidence: 0.9,
      model: 'served-model',
    });
    fakes.apply.mockResolvedValue('applied');
    await processTaskCategoryJobForTests({ db: {} as never }, JOB, {
      acquireTeamPermit,
      classify,
      enabled: true,
    });
    expect(acquireTeamPermit).toHaveBeenCalledWith('team-1');
    expect(acquireTeamPermit.mock.invocationCallOrder[0]).toBeLessThan(
      classify.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('defers a rate-limited team without spending a model call', async () => {
    fakes.getInput.mockResolvedValue({
      packet: { title: 'Build API' },
      requestedInputHash: 'hash-1',
      inputHash: 'hash-1',
    });
    const classify = vi.fn();

    await expect(
      processTaskCategoryJobForTests({ db: {} as never }, JOB, {
        acquireTeamPermit: vi.fn().mockResolvedValue(12_345),
        classify,
        enabled: true,
      }),
    ).resolves.toEqual({ status: 'rate_limited', retryAfterMs: 12_345 });
    expect(classify).not.toHaveBeenCalled();
  });
});
