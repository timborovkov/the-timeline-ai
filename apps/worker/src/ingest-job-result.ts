import { isDelayedIngestResult } from '@timeline/shared/integrations';
import { DelayedError } from 'bullmq';

import { delayWorkerJob, type DelayableJob } from '#src/job-delay.js';

export async function finishIngestJob<T>(job: DelayableJob, result: T, token?: string): Promise<T> {
  if (isDelayedIngestResult(result)) {
    await delayWorkerJob(job, result.retryAfterMs, token);
    // BullMQ must see a deferral, not a completed job or a consumed retry attempt.
    throw new DelayedError();
  }
  return result;
}
