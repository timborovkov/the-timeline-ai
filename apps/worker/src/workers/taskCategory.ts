import { type Db } from '@timeline/db';
import { llm, queue } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import * as taskCategories from '@timeline/shared/task-categories';
import { withTeam } from '@timeline/shared/team-scope';
import { DelayedError, Worker, type Job } from 'bullmq';

import { withWorkerAiBilling, workerBillingJobOptions } from '#src/billing-context.js';
import { captureWorkerJobFailure } from '#src/monitoring.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface TaskCategoryWorkerDeps {
  db: Db;
}

export interface TaskCategoryWorkerIO {
  classify?: typeof taskCategories.classifyTaskCategory;
  now?: () => number;
  enabled?: boolean;
  acquireTeamPermit?: (teamId: string) => Promise<number | null>;
}

const TEAM_RATE_LIMIT_PER_MINUTE = 10;

async function acquireTeamRateLimitPermit(teamId: string): Promise<number | null> {
  const now = Date.now();
  const redis = queue.getRedisConnection();
  const bucket = Math.floor(now / 60_000);
  const key = `timeline:task-category:team-rate:${teamId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 70);
  if (count > TEAM_RATE_LIMIT_PER_MINUTE) {
    return 60_000 - (now % 60_000) + 250;
  }
  return null;
}

function failureCode(error: unknown): string {
  if (error instanceof Error) return error.name || 'model_error';
  return 'model_error';
}

export async function processTaskCategoryJobForTests(
  deps: TaskCategoryWorkerDeps,
  data: queue.TaskCategoryJobData,
  io: TaskCategoryWorkerIO = {},
) {
  const env = getEnv();
  if (
    !(io.enabled ?? (env.TASK_CATEGORY_CLASSIFICATION_ENABLED && env.TASK_CATEGORY_WORKER_ENABLED))
  ) {
    return { status: 'skipped' as const, reason: 'disabled' as const };
  }
  if (data.kind === 'project_fanout') {
    const scope = withTeam(deps.db, data.teamId, ZERO_UUID, { skipMembershipCheck: true });
    const result = await scope.objects.invalidateTaskCategoriesForProject({
      projectId: data.projectId,
      projectVersion: data.projectVersion,
      afterTaskId: data.afterTaskId,
    });
    for (const categoryJob of result.jobs) {
      await queue.enqueueTaskCategoryJob({
        teamId: data.teamId,
        taskId: categoryJob.taskId,
        inputHash: categoryJob.inputHash,
        trigger: 'project_change',
      });
    }
    if (result.nextCursor) {
      await queue.enqueueTaskCategoryJob({ ...data, afterTaskId: result.nextCursor });
    }
    return { status: 'fanout' as const, count: result.jobs.length };
  }
  const scope = withTeam(deps.db, data.teamId, ZERO_UUID, { skipMembershipCheck: true });
  const input = await scope.objects.getTaskCategoryClassificationInput(data.taskId);
  if (!input) return { status: 'skipped' as const, reason: 'not_pending' as const };
  if (input.requestedInputHash !== data.inputHash) {
    return { status: 'skipped' as const, reason: 'stale_job' as const };
  }
  let packet = input.packet;
  if (input.inputHash !== data.inputHash) {
    const refreshed = await scope.objects.refreshTaskCategoryClassificationRequest(
      data.taskId,
      data.inputHash,
    );
    if (!refreshed) return { status: 'skipped' as const, reason: 'stale_job' as const };
    if (refreshed.inputHash !== data.inputHash) {
      await queue.enqueueTaskCategoryJob({
        teamId: data.teamId,
        taskId: data.taskId,
        inputHash: refreshed.inputHash,
        trigger: 'retry',
      });
      return { status: 'refreshed_packet' as const };
    }
    packet = refreshed.packet;
  }
  const retryAfterMs = await io.acquireTeamPermit?.(data.teamId);
  if (retryAfterMs) return { status: 'rate_limited' as const, retryAfterMs };

  const startedAt = (io.now ?? Date.now)();
  const classify = io.classify ?? taskCategories.classifyTaskCategory;
  const prediction = await classify(packet);
  const latencyMs = Math.max(0, (io.now ?? Date.now)() - startedAt);
  const outcome = await scope.objects.applyTaskCategoryClassification({
    taskId: data.taskId,
    inputHash: data.inputHash,
    category: prediction.category,
    confidence: prediction.confidence,
    model: prediction.model,
    latencyMs,
  });
  return { status: outcome, prediction };
}

export function startTaskCategoryWorker(
  deps: TaskCategoryWorkerDeps,
): Worker<queue.TaskCategoryJobData> | null {
  const env = getEnv();
  if (!env.TASK_CATEGORY_CLASSIFICATION_ENABLED || !env.TASK_CATEGORY_WORKER_ENABLED) {
    return null;
  }
  const worker = new Worker<queue.TaskCategoryJobData>(
    queue.QUEUE_NAMES.taskCategory,
    async (job: Job<queue.TaskCategoryJobData>, token?: string) => {
      const startedAt = Date.now();
      try {
        const result = await withWorkerAiBilling(
          deps.db,
          job.data.teamId,
          'task_category',
          () =>
            processTaskCategoryJobForTests(deps, job.data, {
              acquireTeamPermit: acquireTeamRateLimitPermit,
            }),
          workerBillingJobOptions(job, token),
        );
        if (result.status === 'rate_limited') {
          await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
          throw new DelayedError();
        }
        return result;
      } catch (error) {
        if (error instanceof DelayedError) throw error;
        const attempts = job.opts.attempts ?? 1;
        if (job.data.kind !== 'project_fanout' && job.attemptsMade + 1 >= attempts) {
          const scope = withTeam(deps.db, job.data.teamId, ZERO_UUID, {
            skipMembershipCheck: true,
          });
          await scope.objects.failTaskCategoryClassification({
            taskId: job.data.taskId,
            inputHash: job.data.inputHash,
            model: llm.TIMELINE_MODELS.taskCategorization.id,
            failureCode: failureCode(error),
            latencyMs: Math.max(0, Date.now() - startedAt),
          });
        }
        throw error;
      }
    },
    {
      connection: queue.getRedisConnection(),
      concurrency: 3,
      limiter: { max: 30, duration: 60_000 },
    },
  );

  worker.on('failed', (job, err) => {
    captureWorkerJobFailure(err, job, {
      component: 'task_category_worker',
      queueName: queue.QUEUE_NAMES.taskCategory,
      teamId: job?.data.teamId,
      taskId: job?.data.kind === 'project_fanout' || !job?.data ? undefined : job.data.taskId,
    });
  });

  return worker;
}
