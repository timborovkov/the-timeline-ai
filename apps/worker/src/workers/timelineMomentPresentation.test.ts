import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  generateAndStoreTimelineMomentPresentation: vi.fn(),
  withTeam: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared'),
  () => ({
    queue: {
      QUEUE_NAMES: { timelineMomentPresentation: 'timeline-moment-presentation' },
      getRedisConnection: vi.fn(),
    },
  }),
  () => import('@timeline/shared'),
);

await vi.mock(
  import.meta.resolve('@timeline/shared/timeline-moments/generation'),
  () => ({
    generateAndStoreTimelineMomentPresentation: fakes.generateAndStoreTimelineMomentPresentation,
  }),
  () => import('@timeline/shared/timeline-moments/generation'),
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
  async () => ({
    ...(await import('bullmq')),
    Worker: vi.fn(),
  }),
  () => import('bullmq'),
);
await vi.mock(
  import.meta.resolve('#src/monitoring.js'),
  () => ({ captureWorkerJobFailure: vi.fn() }),
  () => import('#src/monitoring.js'),
);

const { processTimelineMomentPresentationJobForTests } =
  await import('#src/workers/timelineMomentPresentation.js');

describe('timeline moment presentation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.withTeam.mockReturnValue({ teamId: 'team-1' });
  });

  it('generates moment presentation with the requesting user visibility scope', async () => {
    fakes.generateAndStoreTimelineMomentPresentation.mockResolvedValue({ status: 'stored' });
    const data = {
      teamId: 'team-1',
      userId: 'user-1',
      rawEventIds: ['event-1', 'event-2'],
      cacheKey: {
        teamId: 'team-1',
        momentKey: 'moment:telegram:chat-a:2026-06-27:18:00',
        visibilityScopeHash: 'visibility-hash',
        visibleSourceEventIdsHash: 'ids-hash',
        visibleSourceContentHash: 'content-hash',
        impactHydrationHash: 'impact-hash',
        artifactClusterHash: 'artifact-hash',
        promptVersion: 'timeline_moment_presentation.v1',
        model: 'test/model',
      },
    };

    await expect(
      processTimelineMomentPresentationJobForTests({ db: {} as never }, data),
    ).resolves.toEqual({ status: 'stored' });

    expect(fakes.withTeam).toHaveBeenCalledWith({}, 'team-1', 'user-1');
    expect(fakes.generateAndStoreTimelineMomentPresentation).toHaveBeenCalledWith(
      {},
      { teamId: 'team-1' },
      {
        rawEventIds: ['event-1', 'event-2'],
        cacheKey: data.cacheKey,
      },
    );
  });

  it('uses a trusted team-visible scope for zero UUID service-actor backfills', async () => {
    fakes.generateAndStoreTimelineMomentPresentation.mockResolvedValue({ status: 'stored' });
    const data = {
      teamId: 'team-1',
      userId: '00000000-0000-0000-0000-000000000000',
      rawEventIds: ['event-1'],
      cacheKey: {
        teamId: 'team-1',
        momentKey: 'moment:telegram:chat-a:2026-06-27:18:00',
        visibilityScopeHash: 'visibility-hash',
        visibleSourceEventIdsHash: 'ids-hash',
        visibleSourceContentHash: 'content-hash',
        impactHydrationHash: 'impact-hash',
        artifactClusterHash: 'artifact-hash',
        promptVersion: 'timeline_moment_presentation.v1',
        model: 'test/model',
      },
    };

    await expect(
      processTimelineMomentPresentationJobForTests({ db: {} as never }, data),
    ).resolves.toEqual({ status: 'stored' });

    expect(fakes.withTeam).toHaveBeenCalledWith(
      {},
      'team-1',
      '00000000-0000-0000-0000-000000000000',
      { skipMembershipCheck: true },
    );
  });
});
