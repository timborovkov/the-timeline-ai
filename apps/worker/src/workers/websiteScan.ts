import type { Db } from '@timeline/db';
import { childLogger } from '@timeline/shared/logger';
import { processWebsiteScanJob } from '@timeline/shared/onboarding';
import { getRedisConnection, QUEUE_NAMES, type WebsiteScanJobData } from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';
import { UnrecoverableError, Worker, type Job } from 'bullmq';

import { captureWorkerJobFailure } from '#src/monitoring.js';
import { guardWorkerProcessor } from '#src/platform-worker.js';

const log = childLogger('worker:website-scan');

export function startWebsiteScanWorker({ db }: { db: Db }): Worker<WebsiteScanJobData> {
  const worker = new Worker<WebsiteScanJobData>(
    QUEUE_NAMES.websiteScan,
    guardWorkerProcessor(db, (job) => processWebsiteScanWorkerJob(db, job)),
    { connection: getRedisConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, err: error }, 'website scan job failed');
    captureWorkerJobFailure(error, job, { operation: 'website_scan' });
  });
  return worker;
}

export async function processWebsiteScanWorkerJob(
  db: Db,
  job: Job<WebsiteScanJobData>,
): Promise<void> {
  const { teamId, userId } = job.data;
  if (!teamId || !userId) {
    throw new UnrecoverableError('website_scan_missing_scope');
  }
  const scope = withTeam(db, teamId, userId);
  try {
    await processWebsiteScanJob({
      userId,
      getFirstRun: () => scope.onboarding.getFirstRun(),
      createEvent: (input) => scope.timeline.createEvent(input),
      attachCapture: (input) => scope.onboarding.attachCapture(input),
      markScanFailed: (reason) => scope.onboarding.markScanFailed(reason),
    });
  } catch (error) {
    if (job.attemptsStarted >= 3) {
      await scope.onboarding.markScanFailed('unreachable').catch((err: unknown) => {
        log.error({ err }, 'failed to record website scan failure after retries');
      });
      throw new UnrecoverableError('website_scan_attempts_exhausted');
    }
    throw error;
  }
}
