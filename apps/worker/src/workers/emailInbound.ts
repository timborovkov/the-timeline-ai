import { inboundDispatcherDeps, processEmailInboundJob, ResendError } from '@timeline/shared/email';
import { childLogger } from '@timeline/shared/logger';
import { getRedisConnection, QUEUE_NAMES, type EmailInboundJobData } from '@timeline/shared/queue';
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';

import type { Db } from '@timeline/db';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:email-inbound');

export function startEmailInboundWorker({ db }: { db: Db }): Worker<EmailInboundJobData> {
  const worker = new Worker<EmailInboundJobData>(
    QUEUE_NAMES.emailInbound,
    (job, token) => processInboundJob(db, job, token),
    { connection: getRedisConnection(), concurrency: 2 },
  );
  worker.on('failed', (job, error) => {
    log.error({ jobId: job?.id, err: error }, 'inbound email job failed');
    captureWorkerJobFailure(error, job, { operation: 'email_inbound' });
  });
  return worker;
}

/** Injectable processing boundary also used by retry contract tests. */
export async function processInboundJob(
  db: Db,
  job: Job<EmailInboundJobData>,
  token?: string,
  process = processEmailInboundJob,
): Promise<void> {
  try {
    await process({ dispatcher: inboundDispatcherDeps(db) }, job.data);
  } catch (error) {
    if (job.attemptsStarted >= 8)
      throw new UnrecoverableError(
        error instanceof ResendError ? error.code : 'email_ingest_attempts_exhausted',
      );
    if (error instanceof ResendError) {
      if (!error.retryable) throw new UnrecoverableError(error.code);
      if (error.retryAfterMs > 0) {
        const delay = Math.max(error.retryAfterMs, 30_000 * 2 ** (job.attemptsStarted - 1));
        await job.moveToDelayed(Date.now() + delay, token);
        throw new DelayedError();
      }
    }
    throw error;
  }
}
