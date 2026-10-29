import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  generateAndStoreObjectSummary: vi.fn(),
  withTeam: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared'),
  () => ({
    queue: {
      QUEUE_NAMES: { objectSummary: 'object-summary' },
      getRedisConnection: vi.fn(),
    },
  }),
  () => import('@timeline/shared'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/objects'),
  () => ({
    generateAndStoreObjectSummary: fakes.generateAndStoreObjectSummary,
  }),
  () => import('@timeline/shared/objects'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: fakes.withTeam,
  }),
  () => import('@timeline/shared/team-scope'),
);

await vi.mock(
  import.meta.resolve('bullmq'),
  () => ({ Worker: vi.fn() }),
  () => import('bullmq'),
);
await vi.mock(
  import.meta.resolve('#src/monitoring.js'),
  () => ({ captureWorkerJobFailure: vi.fn() }),
  () => import('#src/monitoring.js'),
);

const { processObjectSummaryJobForTests } = await import('#src/workers/objectSummary.js');

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
