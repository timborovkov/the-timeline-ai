import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  generateAndStoreObjectSummary: vi.fn(),
  withTeam: vi.fn(),
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

vi.mock('bullmq', () => ({ Worker: vi.fn() }));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));

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

  it('throws failed generations so BullMQ can retry them', async () => {
    fakes.generateAndStoreObjectSummary.mockResolvedValue({
      status: 'failed',
      reason: 'invalid_source_ref',
    });

    await expect(
      processObjectSummaryJobForTests(
        { db: {} as never },
        { teamId: 'team-1', objectId: 'object-1' },
      ),
    ).rejects.toThrow('invalid_source_ref');
  });
});
