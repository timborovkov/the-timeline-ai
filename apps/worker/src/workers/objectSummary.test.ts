import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  generateAndStoreObjectSummary: vi.fn(),
  withTeam: vi.fn(),
  withWorkerAiBilling: vi.fn(
    async (
      _db: unknown,
      _teamId: string,
      _operationClass: string,
      fn: () => Promise<unknown>,
      _options?: { jobId?: string },
    ) => fn(),
  ),
}));

vi.mock('@timeline/shared', () => ({
  queue: {
    QUEUE_NAMES: { objectSummary: 'object-summary' },
    getRedisConnection: vi.fn(),
  },
}));

vi.mock('@timeline/shared/objects', () => ({
  generateAndStoreObjectSummary: fakes.generateAndStoreObjectSummary,
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: fakes.withTeam,
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function WorkerMock() {
    return { on: vi.fn() };
  }),
}));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));
vi.mock('#src/billing-context.js', () => ({
  withWorkerAiBilling: fakes.withWorkerAiBilling,
  workerBillingJobOptions: (
    job: { id?: string; moveToDelayed: (timestamp: number, token?: string) => Promise<void> },
    token?: string,
  ) => ({
    ...(job.id ? { jobId: job.id } : {}),
    delayJob: (delayMs: number) => job.moveToDelayed(Date.now() + delayMs, token),
  }),
}));

const { objectSummaryBillingJobId, processObjectSummaryJobForTests, startObjectSummaryWorker } =
  await import('#src/workers/objectSummary.js');

describe('object summary worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.withTeam.mockReturnValue({ teamId: 'team-1' });
  });

  it('generates summaries with an internal team scope', async () => {
    fakes.generateAndStoreObjectSummary.mockResolvedValue({ status: 'ready' });

    await expect(
      processObjectSummaryJobForTests(
        { db: {} as never },
        { teamId: 'team-1', objectId: 'object-1', trigger: 'manual' },
      ),
    ).resolves.toEqual({ status: 'ready' });

    expect(fakes.withTeam).toHaveBeenCalledWith(
      {},
      'team-1',
      '00000000-0000-0000-0000-000000000000',
      { skipMembershipCheck: true },
    );
    expect(fakes.generateAndStoreObjectSummary).toHaveBeenCalledWith(
      {},
      { teamId: 'team-1' },
      'object-1',
      { trigger: 'manual' },
    );
  });

  it('returns persisted failed generations without retrying deterministic failures', async () => {
    fakes.generateAndStoreObjectSummary.mockResolvedValue({
      status: 'failed',
      reason: 'invalid_source_ref',
      retryable: false,
    });

    await expect(
      processObjectSummaryJobForTests(
        { db: {} as never },
        { teamId: 'team-1', objectId: 'object-1' },
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'invalid_source_ref', retryable: false });
  });

  it('bills each object-summary generation separately and reuses that id on retry', async () => {
    const stableId = 'object-summary|team-1|object-1';
    const firstGeneration = 1_700_000_000_000;
    const refreshGeneration = 1_700_000_111_000;
    expect(objectSummaryBillingJobId({ id: stableId, timestamp: firstGeneration })).toBe(
      `${stableId}:${String(firstGeneration)}`,
    );
    expect(objectSummaryBillingJobId({ id: stableId, timestamp: firstGeneration })).toBe(
      objectSummaryBillingJobId({ id: stableId, timestamp: firstGeneration }),
    );
    expect(objectSummaryBillingJobId({ id: stableId, timestamp: refreshGeneration })).toBe(
      `${stableId}:${String(refreshGeneration)}`,
    );

    const { Worker } = await import('bullmq');
    fakes.generateAndStoreObjectSummary.mockResolvedValue({ status: 'ready' });
    startObjectSummaryWorker({ db: {} as never });
    const processor = vi.mocked(Worker).mock.calls[0]?.[1] as
      | ((
          job: {
            id: string;
            timestamp: number;
            attemptsMade: number;
            data: { teamId: string; objectId: string };
            moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
          },
          token?: string,
        ) => Promise<unknown>)
      | undefined;
    if (!processor) throw new Error('object summary worker did not register a processor');
    const moveToDelayed = vi.fn(() => Promise.resolve());
    await processor(
      {
        id: stableId,
        timestamp: firstGeneration,
        attemptsMade: 1,
        data: { teamId: 'team-1', objectId: 'object-1' },
        moveToDelayed,
      },
      'retry-token',
    );
    await processor(
      {
        id: stableId,
        timestamp: refreshGeneration,
        attemptsMade: 0,
        data: { teamId: 'team-1', objectId: 'object-1' },
        moveToDelayed,
      },
      'refresh-token',
    );

    const billedIds = fakes.withWorkerAiBilling.mock.calls.map((call) => call[4]?.jobId);
    expect(billedIds).toEqual([
      `${stableId}:${String(firstGeneration)}`,
      `${stableId}:${String(refreshGeneration)}`,
    ]);
  });

  it('throws retryable failed generations so BullMQ can retry transient failures', async () => {
    fakes.generateAndStoreObjectSummary.mockResolvedValue({
      status: 'failed',
      reason: 'provider unavailable',
      retryable: true,
    });

    await expect(
      processObjectSummaryJobForTests(
        { db: {} as never },
        { teamId: 'team-1', objectId: 'object-1' },
      ),
    ).rejects.toThrow('provider unavailable');
  });
});
