import type { Db } from '@timeline/db';
import type { WebsiteScanJobData } from '@timeline/shared/queue';
import { expect, vi } from '@timeline/test-support';
import { UnrecoverableError, type Job } from 'bullmq';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  processWebsiteScanJob: vi.fn(),
  getFirstRun: vi.fn(),
  createEvent: vi.fn(),
  attachCapture: vi.fn(),
  markScanFailed: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/onboarding'),
  () => ({ processWebsiteScanJob: fakes.processWebsiteScanJob }),
  () => import('@timeline/shared/onboarding'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      onboarding: {
        getFirstRun: fakes.getFirstRun,
        attachCapture: fakes.attachCapture,
        markScanFailed: fakes.markScanFailed,
      },
      timeline: { createEvent: fakes.createEvent },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { processWebsiteScanWorkerJob } = await import('#src/workers/websiteScan.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function job(attemptsStarted = 1): Job<WebsiteScanJobData> {
  return {
    data: { teamId: TEAM_ID, userId: USER_ID },
    attemptsStarted,
  } as Job<WebsiteScanJobData>;
}

describe('website scan worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.processWebsiteScanJob.mockResolvedValue(undefined);
    fakes.markScanFailed.mockResolvedValue({});
  });

  it('runs the shared job through withTeam', async () => {
    await processWebsiteScanWorkerJob({} as Db, job());
    expect(fakes.processWebsiteScanJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
      }),
    );
  });

  it('records unreachable and stops after the last attempt', async () => {
    fakes.processWebsiteScanJob.mockRejectedValue(new Error('dns'));
    await expect(processWebsiteScanWorkerJob({} as Db, job(3))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(fakes.markScanFailed).toHaveBeenCalledWith('unreachable');
  });
});
