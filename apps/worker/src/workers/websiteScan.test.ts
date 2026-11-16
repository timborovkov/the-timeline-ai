import type { Db } from '@timeline/db';
import type { WebsiteScanJobData } from '@timeline/shared/queue';
import { expect, vi } from '@timeline/test-support';
import { UnrecoverableError, type Job } from 'bullmq';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  processWebsiteScanJob: vi.fn(),
  processPersistentWebsiteScan: vi.fn(),
  failWebsiteRun: vi.fn(),
  getFirstRun: vi.fn(),
  createEvent: vi.fn(),
  attachCapture: vi.fn(),
  markScanFailed: vi.fn(),
  release: vi.fn(() => Promise.resolve({})),
}));

await vi.mock(
  import.meta.resolve('@timeline/shared/websites'),
  () => ({
    processPersistentWebsiteScan: fakes.processPersistentWebsiteScan,
    failWebsiteRun: fakes.failWebsiteRun,
    tickWebsiteSchedules: () => Promise.resolve(undefined),
    settleCapturedWebsiteRun: () => Promise.resolve(undefined),
  }),
  () => import('@timeline/shared/websites'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/onboarding'),
  () => ({ processWebsiteScanJob: fakes.processWebsiteScanJob, WEBSITE_SCAN_PAGE_CAP: 5 }),
  () => import('@timeline/shared/onboarding'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      websites: {
        adoptLegacyScan: () => Promise.resolve(undefined),
        updateRun: () => Promise.resolve(undefined),
      },
      onboarding: {
        getFirstRun: fakes.getFirstRun,
        getWebsiteScanPages: () => Promise.resolve(null),
        getWebsiteCrawlId: () => Promise.resolve(null),
        attachCapture: fakes.attachCapture,
        markScanFailed: fakes.markScanFailed,
      },
      billing: { release: fakes.release },
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
    data: { teamId: TEAM_ID, userId: USER_ID, scanId: TEAM_ID },
    attemptsStarted,
    opts: { attempts: 4 },
    attemptsMade: attemptsStarted - 1,
  } as Job<WebsiteScanJobData>;
}

describe('website scan worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.processWebsiteScanJob.mockResolvedValue(undefined);
    fakes.processPersistentWebsiteScan.mockResolvedValue(false);
    fakes.failWebsiteRun.mockResolvedValue(undefined);
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

  it('processes persistent onboarding scans without invoking the legacy onboarding adapter', async () => {
    fakes.processPersistentWebsiteScan.mockResolvedValue(true);
    await processWebsiteScanWorkerJob({} as Db, job());
    expect(fakes.processWebsiteScanJob).not.toHaveBeenCalled();
    expect(fakes.getFirstRun).not.toHaveBeenCalled();
  });

  it('records unreachable and stops after the last attempt', async () => {
    fakes.processWebsiteScanJob.mockRejectedValue(new Error('dns'));
    await expect(processWebsiteScanWorkerJob({} as Db, job(4))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(fakes.markScanFailed).toHaveBeenCalledWith('unreachable', TEAM_ID);
  });
});
