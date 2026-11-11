import { type Db } from '@timeline/db';
import { queue } from '@timeline/shared';
import { processTeamLifecycle } from '@timeline/shared/team-lifecycle/processor';
import { Queue, Worker } from 'bullmq';

export const TEAM_LIFECYCLE_QUEUE = 'team-lifecycle';
let scheduler: Queue | undefined;
export function startTeamLifecycleWorker({ db }: { db: Db }) {
  scheduler = new Queue(TEAM_LIFECYCLE_QUEUE, { connection: queue.getRedisConnection() });

  return new Worker(TEAM_LIFECYCLE_QUEUE, () => processTeamLifecycle(db), {
    connection: queue.getRedisConnection(),
    concurrency: 1,
  });
}
export async function closeTeamLifecycleQueue() {
  await scheduler?.close();
  scheduler = undefined;
}

export async function scheduleTeamLifecycle() {
  if (!scheduler) throw new Error('Lifecycle worker must start before scheduling');
  await scheduler.upsertJobScheduler(
    'team-lifecycle-poll',
    { every: 60000 },
    { name: 'poll', data: {}, opts: { removeOnComplete: true, removeOnFail: 20 } },
  );
}
