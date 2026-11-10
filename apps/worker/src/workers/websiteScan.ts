import type { Db } from '@timeline/db';
import { listChargeCentsForMeter } from '@timeline/shared/billing';
import { childLogger } from '@timeline/shared/logger';
import { processWebsiteScanJob, WEBSITE_SCAN_PAGE_CAP } from '@timeline/shared/onboarding';
import {
  enqueueDocChunkEmbedJob,
  getRedisConnection,
  QUEUE_NAMES,
  type WebsiteScanJobData,
} from '@timeline/shared/queue';
import { withTeam } from '@timeline/shared/team-scope';
import { UnrecoverableError, Worker, type Job } from 'bullmq';

import { captureWorkerJobFailure } from '#src/monitoring.js';
import { guardWorkerProcessor } from '#src/platform-worker.js';

const log = childLogger('worker:website-scan');
const WEBSITE_SCAN_LOCK_DURATION_MS = 120_000;

export function startWebsiteScanWorker({ db }: { db: Db }): Worker<WebsiteScanJobData> {
  const worker = new Worker<WebsiteScanJobData>(
    QUEUE_NAMES.websiteScan,
    guardWorkerProcessor(db, (job) => processWebsiteScanWorkerJob(db, job)),
    {
      connection: getRedisConnection(),
      concurrency: 2,
      lockDuration: WEBSITE_SCAN_LOCK_DURATION_MS,
    },
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
  const { teamId, userId, scanId } = job.data;
  if (!teamId || !userId || !scanId) {
    throw new UnrecoverableError('website_scan_missing_scope');
  }
  const scope = withTeam(db, teamId, userId);
  const operationId = `website-scan:${scanId}`;
  try {
    await processWebsiteScanJob({
      scanId,
      reserve: async () =>
        (
          await scope.billing.reserve({
            operationId,
            meterId: 'accepted_sources',
            reservedNativeUnits: WEBSITE_SCAN_PAGE_CAP,
            reservedChargeCents: listChargeCentsForMeter('accepted_sources', WEBSITE_SCAN_PAGE_CAP),
            ttlMs: 30 * 60_000,
          })
        ).ok,
      settle: async (pageCount) => {
        await scope.billing.settle({
          operationId,
          meterId: 'accepted_sources',
          nativeUnits: pageCount,
          customerChargeCents: listChargeCentsForMeter('accepted_sources', pageCount),
          operationClass: 'ingest',
          source: 'website_scan',
        });
      },
      release: async () => {
        await scope.billing.release(operationId);
      },
      getPages: () => scope.onboarding.getWebsiteScanPages(scanId),
      savePages: (input) => scope.onboarding.saveWebsiteScanPages(input),
      saveDocument: async (input) => {
        const saved = await scope.onboarding.saveWebsitePageDocument(input);
        for (const chunkId of saved.chunkIds) await enqueueDocChunkEmbedJob(teamId, chunkId);
      },
      userId,
      getFirstRun: () => scope.onboarding.getFirstRun(),
      createEvent: (input) => scope.timeline.createEvent(input),
      attachCapture: (input) => scope.onboarding.attachCapture(input),
      markScanFailed: (reason, id) => scope.onboarding.markScanFailed(reason, id),
    });
  } catch (error) {
    if (job.attemptsStarted >= 3) {
      await scope.billing.release(operationId);
      await scope.onboarding.markScanFailed('unreachable', scanId).catch((err: unknown) => {
        log.error({ err }, 'failed to record website scan failure after retries');
      });
      throw new UnrecoverableError('website_scan_attempts_exhausted');
    }
    throw error;
  }
}
