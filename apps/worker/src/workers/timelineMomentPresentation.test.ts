import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  generateAndStoreTimelineMomentPresentation: vi.fn(),
  withTeam: vi.fn(),
}));

vi.mock('@timeline/shared', () => ({
  queue: {
    QUEUE_NAMES: { timelineMomentPresentation: 'timeline-moment-presentation' },
    getRedisConnection: vi.fn(),
  },
}));

vi.mock('@timeline/shared/timeline-moments/generation', () => ({
  generateAndStoreTimelineMomentPresentation: fakes.generateAndStoreTimelineMomentPresentation,
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: fakes.withTeam,
}));

vi.mock('bullmq', () => ({ Worker: vi.fn() }));
vi.mock('#src/monitoring.js', () => ({ captureWorkerJobFailure: vi.fn() }));

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
});
