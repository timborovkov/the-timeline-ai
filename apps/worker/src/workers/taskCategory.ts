import { type Db } from '@timeline/db';
import { llm, queue } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import * as taskCategories from '@timeline/shared/task-categories';
import { withTeam } from '@timeline/shared/team-scope';
import { Worker, type Job } from 'bullmq';

import { captureWorkerJobFailure } from '#src/monitoring.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface TaskCategoryWorkerDeps {
  db: Db;
}

export interface TaskCategoryWorkerIO {
  classify?: typeof taskCategories.classifyTaskCategory;
  now?: () => number;
  enabled?: boolean;
  acquireTeamPermit?: (teamId: string) => Promise<void>;
}

const TEAM_RATE_LIMIT_PER_MINUTE = 10;

async function acquireTeamRateLimitPermit(teamId: string): Promise<void> {
  const redis = queue.getRedisConnection();
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `timeline:task-category:team-rate:${teamId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 70);
  if (count > TEAM_RATE_LIMIT_PER_MINUTE) {
    const error = new Error('Task category team rate limit exceeded');
    error.name = 'TeamRateLimitError';
    throw error;
  }
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
  if (input.inputHash !== data.inputHash) {
    return { status: 'skipped' as const, reason: 'stale_packet' as const };
  }
  await io.acquireTeamPermit?.(data.teamId);

  const startedAt = (io.now ?? Date.now)();
  const classify = io.classify ?? taskCategories.classifyTaskCategory;
  const prediction = await classify(input.packet);
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
): Worker<queue.TaskCategoryJobData> {
  const worker = new Worker<queue.TaskCategoryJobData>(
    queue.QUEUE_NAMES.taskCategory,
    async (job: Job<queue.TaskCategoryJobData>) => {
      const startedAt = Date.now();
      try {
        return await processTaskCategoryJobForTests(deps, job.data, {
          acquireTeamPermit: acquireTeamRateLimitPermit,
        });
      } catch (error) {
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
