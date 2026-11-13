import type { Db } from '@timeline/db';
import { queue } from '@timeline/shared';
import { isBillingAdmissionError } from '@timeline/shared/billing';
import { runGuardedJob } from '@timeline/shared/platform-admin/runtime';
import { withTeam } from '@timeline/shared/team-scope';
import { Queue, UnrecoverableError, Worker } from 'bullmq';

import { withWorkerAiBilling } from '#src/billing-context.js';
import { discoverBoardQualificationRequests } from '#src/workers/boardQualification-discovery.js';

export const BOARD_QUALIFICATION_QUEUE = 'board-qualification';
let scheduler: Queue | undefined;

export function startBoardQualificationWorker({ db }: { db: Db }) {
  scheduler = new Queue(BOARD_QUALIFICATION_QUEUE, { connection: queue.getRedisConnection() });
  return new Worker(
    BOARD_QUALIFICATION_QUEUE,
    async () => {
      // Global discovery reads routing metadata only; all tenant work uses the real member scope.
      const requests = await discoverBoardQualificationRequests(db);
      for (const request of requests) {
        const redis = queue.getRedisConnection();
        const permit = await redis.set(
          `board-qualification:rate:${request.teamId}`,
          '1',
          'EX',
          30,
          'NX',
        );
        if (!permit) continue;
        const scope = withTeam(db, request.teamId, request.userId);
        try {
          await runGuardedJob(
            request,
            () =>
              withWorkerAiBilling(db, request.teamId, 'suggestion', () =>
                scope.boardQualification.processRequest(request.id, undefined, request.version),
              ),
            db,
          );
        } catch (error) {
          if (isBillingAdmissionError(error) || error instanceof UnrecoverableError) throw error;
          // Keep customer/model text out of operational logs. Durable retry state is inspectable.
          await scope.boardQualification
            .failRequest(request.id, request.version)
            .catch(() => undefined);
        }
      }
    },
    { connection: queue.getRedisConnection(), concurrency: 1 },
  );
}
export async function closeBoardQualificationQueue() {
  await scheduler?.close();
  scheduler = undefined;
}
export async function scheduleBoardQualification() {
  if (!scheduler) throw new Error('Board qualification worker must start before scheduling');
  await scheduler.upsertJobScheduler(
    'board-qualification-poll',
    { every: 5000 },
    { name: 'poll', data: {}, opts: { removeOnComplete: true, removeOnFail: 20 } },
  );
}
