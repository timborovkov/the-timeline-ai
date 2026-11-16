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
import {
  processPersistentWebsiteScan,
  tickWebsiteSchedules,
  failWebsiteRun,
  settleCapturedWebsiteRun,
} from '@timeline/shared/websites';
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';

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
      settings: {
        backoffStrategy: (attemptsMade, _type, error) =>
          Math.max(
            5000 * 2 ** (attemptsMade - 1),
            error && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number'
              ? error.retryAfterMs
              : 0,
          ),
      },
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
  let legacyAttempt = false;
  let legacyProviderClaimed = false;
  try {
    if (await processPersistentWebsiteScan(db, teamId, userId, scanId)) return;
    legacyAttempt = true;
    const legacyState = await scope.onboarding.getFirstRun();
    const legacyRun = legacyState?.websiteUrl
      ? await scope.websites.prepareLegacyScan({
          scanId,
          url: legacyState.websiteUrl,
          subject: legacyState.websiteSubject,
        })
      : null;
    if (legacyRun) {
      const legacySource = await scope.websites.get(legacyRun.websiteId);
      if (legacySource.paused || legacySource.archivedAt) {
        await settleCapturedWebsiteRun(db, teamId, scanId);
        await scope.billing.release(operationId);
        await scope.websites.updateRun(scanId, { status: 'cancelled', finishedAt: new Date() });
        return;
      }
    }
    const cachedPages = await scope.onboarding.getWebsiteScanPages(scanId);
    const legacyCrawlId = await scope.onboarding.getWebsiteCrawlId(scanId);
    if (legacyRun?.providerStartedAt && !legacyCrawlId && !cachedPages) {
      log.error(
        { teamId, scanId },
        'Website provider acceptance unknown; operator reconciliation required',
      );
      await scope.websites.updateRun(scanId, {
        status: 'failed',
        failureReason: 'provider_acceptance_unknown',
        finishedAt: new Date(),
        leaseUntil: null,
      });
      await scope.billing.release(operationId);
      return;
    }
    await processWebsiteScanJob({
      scanId,
      reserve: async () => {
        if (cachedPages) return true;
        const admission = await scope.billing.reserve({
          operationId,
          meterId: 'accepted_sources',
          reservedNativeUnits: WEBSITE_SCAN_PAGE_CAP,
          reservedChargeCents: listChargeCentsForMeter('accepted_sources', WEBSITE_SCAN_PAGE_CAP),
          ttlMs: 30 * 60_000,
        });
        if (admission.ok && legacyRun) {
          if (!(await scope.websites.claimProvider(scanId)))
            throw new Error('website_provider_busy');
          legacyProviderClaimed = true;
        }
        return admission.ok;
      },
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
        await settleCapturedWebsiteRun(db, teamId, scanId);
        if (legacyRun)
          await scope.websites.updateRun(scanId, {
            status: 'cancelled',
            finishedAt: new Date(),
            ...(legacyProviderClaimed ? { providerFinishedAt: new Date() } : {}),
            leaseUntil: null,
          });
        await scope.billing.release(operationId);
      },
      getCrawlId: () => scope.onboarding.getWebsiteCrawlId(scanId),
      saveCrawlId: (input) => scope.onboarding.saveWebsiteCrawlId(input),
      getPages: () => scope.onboarding.getWebsiteScanPages(scanId),
      savePages: async (input) => {
        const pages = await scope.onboarding.saveWebsiteScanPages(input);
        if (legacyRun)
          await scope.websites.updateRun(scanId, {
            providerFinishedAt: new Date(),
            leaseUntil: null,
          });
        return pages;
      },
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
    await scope.websites.adoptLegacyScan(scanId);
  } catch (error) {
    if (legacyAttempt && !(error instanceof Error && error.message === 'website_provider_busy'))
      await scope.websites
        .updateRun(scanId, {
          leaseUntil: null,
          ...(error instanceof Error &&
          'providerRejected' in error &&
          error.providerRejected === true
            ? { providerStartedAt: null }
            : {}),
        })
        .catch(() => undefined);
    if (error instanceof Error && error.message === 'website_provider_busy') {
      await job.moveToDelayed(Date.now() + 30_000, job.token);
      throw new DelayedError();
    }
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 4)) {
      await failWebsiteRun(db, teamId, scanId, 'attempts_exhausted');
      await scope.onboarding.markScanFailed('unreachable', scanId).catch((err: unknown) => {
        log.error({ err }, 'failed to record website scan failure after retries');
      });
      throw new UnrecoverableError('website_scan_attempts_exhausted');
    }
    throw error;
  }
}

export function startWebsiteSchedulerWorker({ db }: { db: Db }): Worker {
  return new Worker(QUEUE_NAMES.websiteScheduler, () => tickWebsiteSchedules(db), {
    connection: getRedisConnection(),
    concurrency: 1,
  });
}
