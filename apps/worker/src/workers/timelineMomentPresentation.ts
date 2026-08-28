import { type Db } from '@timeline/db';
import { queue } from '@timeline/shared';
import { withTeam } from '@timeline/shared/team-scope';
import { generateAndStoreTimelineMomentPresentation } from '@timeline/shared/timeline-moments/generation';
import { Worker, type Job } from 'bullmq';

import { withWorkerAiBilling, workerBillingJobOptions } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface TimelineMomentPresentationWorkerDeps {
  db: Db;
}

function timelineMomentPresentationFailureTags(
  job: Pick<Job<queue.TimelineMomentPresentationJobData>, 'data'> | undefined,
) {
  return {
    component: 'timeline_moment_presentation_worker',
    queueName: queue.QUEUE_NAMES.timelineMomentPresentation,
    teamId: job?.data.teamId,
    momentKey: job?.data.cacheKey.momentKey,
  };
}

export async function processTimelineMomentPresentationJobForTests(
  deps: TimelineMomentPresentationWorkerDeps,
  data: queue.TimelineMomentPresentationJobData,
) {
  const scope =
    data.userId === ZERO_UUID
      ? withTeam(deps.db, data.teamId, data.userId, { skipMembershipCheck: true })
      : withTeam(deps.db, data.teamId, data.userId);
  return generateAndStoreTimelineMomentPresentation(deps.db, scope, {
    rawEventIds: data.rawEventIds,
    cacheKey: data.cacheKey,
  });
}

export function startTimelineMomentPresentationWorker(
  deps: TimelineMomentPresentationWorkerDeps,
): Worker<queue.TimelineMomentPresentationJobData> {
  const worker = new Worker<queue.TimelineMomentPresentationJobData>(
    queue.QUEUE_NAMES.timelineMomentPresentation,
    async (job: Job<queue.TimelineMomentPresentationJobData>, token?: string) =>
      withWorkerAiBilling(
        deps.db,
        job.data.teamId,
        'presentation',
        () => processTimelineMomentPresentationJobForTests(deps, job.data),
        workerBillingJobOptions(job, token),
      ),
    {
      connection: queue.getRedisConnection(),
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    captureWorkerJobFailure(err, job, timelineMomentPresentationFailureTags(job));
  });

  return worker;
}
