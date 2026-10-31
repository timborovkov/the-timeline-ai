import { type Db } from '@timeline/db';
import { queue } from '@timeline/shared';
import { generateAndStoreObjectSummary } from '@timeline/shared/objects';
import { withTeam } from '@timeline/shared/team-scope';
import { Worker, type Job } from 'bullmq';

import { withWorkerAiBilling, workerBillingJobOptions } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface ObjectSummaryWorkerDeps {
  db: Db;
}

function objectSummaryFailureTags(job: Pick<Job<queue.ObjectSummaryJobData>, 'data'> | undefined) {
  return {
    component: 'object_summary_worker',
    queueName: queue.QUEUE_NAMES.objectSummary,
    teamId: job?.data.teamId,
    objectId: job?.data.objectId,
  };
}

/**
 * Billing operation id for one object-summary job.
 * BullMQ retries keep `timestamp`. A refresh removes the completed job and
 * adds another with the same custom id and a new timestamp, so it must not
 * reuse the settled summary.
 */
export function objectSummaryBillingJobId(job: {
  id?: string;
  timestamp?: number;
}): string | undefined {
  if (!job.id) return undefined;
  if (typeof job.timestamp === 'number' && Number.isFinite(job.timestamp)) {
    return `${job.id}:${String(job.timestamp)}`;
  }
  return job.id;
}

export async function processObjectSummaryJobForTests(
  deps: ObjectSummaryWorkerDeps,
  data: queue.ObjectSummaryJobData,
) {
  const scope = withTeam(deps.db, data.teamId, ZERO_UUID, { skipMembershipCheck: true });
  const result = await generateAndStoreObjectSummary(deps.db, scope, data.objectId, {
    trigger: data.trigger ?? 'auto',
  });
  if (result.status === 'failed' && result.retryable) {
    throw new Error(result.reason ?? 'object_summary_failed');
  }
  return result;
}

export function startObjectSummaryWorker(
  deps: ObjectSummaryWorkerDeps,
): Worker<queue.ObjectSummaryJobData> {
  const worker = new Worker<queue.ObjectSummaryJobData>(
    queue.QUEUE_NAMES.objectSummary,
    async (job: Job<queue.ObjectSummaryJobData>, token?: string) => {
      const billingJobId = objectSummaryBillingJobId(job);
      return withWorkerAiBilling(
        deps.db,
        job.data.teamId,
        'summary',
        () => processObjectSummaryJobForTests(deps, job.data),
        {
          ...workerBillingJobOptions(job, token),
          ...(billingJobId ? { jobId: billingJobId } : {}),
        },
      );
    },
    {
      connection: queue.getRedisConnection(),
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    captureWorkerJobFailure(err, job, objectSummaryFailureTags(job));
  });

  return worker;
}
