import { type Db } from '@timeline/db';
import { queue } from '@timeline/shared';
import { generateAndStoreObjectSummary } from '@timeline/shared/objects';
import { withTeam } from '@timeline/shared/team-scope';
import { Worker, type Job } from 'bullmq';

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

export async function processObjectSummaryJobForTests(
  deps: ObjectSummaryWorkerDeps,
  data: queue.ObjectSummaryJobData,
) {
  const scope = withTeam(deps.db, data.teamId, ZERO_UUID, { skipMembershipCheck: true });
  const result = await generateAndStoreObjectSummary(deps.db, scope, data.objectId, {
    trigger: data.trigger ?? 'auto',
  });
  return result;
}

export function startObjectSummaryWorker(
  deps: ObjectSummaryWorkerDeps,
): Worker<queue.ObjectSummaryJobData> {
  const worker = new Worker<queue.ObjectSummaryJobData>(
    queue.QUEUE_NAMES.objectSummary,
    async (job: Job<queue.ObjectSummaryJobData>) => processObjectSummaryJobForTests(deps, job.data),
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
