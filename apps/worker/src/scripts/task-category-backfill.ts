import { pathToFileURL } from 'node:url';

import { closeDb, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTIMATED_INPUT_TOKENS_PER_TASK = 220;
const ESTIMATED_OUTPUT_TOKENS_PER_TASK = 20;
const ESTIMATED_COST_USD_PER_TASK = 0.0002;

type TaskCategoryBackfillFlags = Pick<
  ReturnType<typeof getEnv>,
  | 'TASK_CATEGORY_CLASSIFICATION_ENABLED'
  | 'TASK_CATEGORY_BACKFILL_ENABLED'
  | 'TASK_CATEGORY_WORKER_ENABLED'
>;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : null;
}

export async function enqueueTaskCategoryBackfillBatch(
  taskIds: readonly string[],
  deps: {
    enqueue: (taskId: string) => Promise<unknown>;
    writeError?: (text: string) => void;
    setExitCode?: (code: number) => void;
  },
): Promise<{ enqueued: number; failed: number }> {
  const writeError = deps.writeError ?? ((text: string) => process.stderr.write(text));
  const setExitCode = deps.setExitCode ?? ((code: number) => (process.exitCode = code));
  let enqueued = 0;
  let failed = 0;
  for (const taskId of taskIds) {
    try {
      await deps.enqueue(taskId);
      enqueued += 1;
    } catch (error) {
      failed += 1;
      writeError(
        `${JSON.stringify({ taskId, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
  }
  if (failed > 0) setExitCode(1);
  return { enqueued, failed };
}

export function assertTaskCategoryBackfillModeEnabled(
  execute: boolean,
  env: TaskCategoryBackfillFlags = getEnv(),
): void {
  if (!execute) return;
  if (
    !env.TASK_CATEGORY_CLASSIFICATION_ENABLED ||
    !env.TASK_CATEGORY_BACKFILL_ENABLED ||
    !env.TASK_CATEGORY_WORKER_ENABLED
  ) {
    throw new Error('Task category backfill execution is disabled by an operational kill switch');
  }
}

export async function closeTaskCategoryBackfillResources(
  deps: {
    closeQueue?: () => Promise<void>;
    closeRedis?: () => Promise<void>;
    closeDatabase?: () => Promise<void>;
  } = {},
): Promise<void> {
  await Promise.all([
    (deps.closeQueue ?? queue.closeTaskCategoryQueue)(),
    (deps.closeRedis ?? queue.closeRedisConnection)(),
    (deps.closeDatabase ?? closeDb)(),
  ]);
}

async function main(): Promise<void> {
  const teamId = argument('--team-id');
  if (!teamId || !UUID_RE.test(teamId)) {
    throw new Error('Pass one team with --team-id <uuid>');
  }
  const requestedLimit = Number(argument('--limit') ?? '500');
  const limit = Math.min(
    Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 500, 1),
    5_000,
  );
  const requestedOffset = Number(argument('--offset') ?? '0');
  const offset = Math.max(Number.isInteger(requestedOffset) ? requestedOffset : 0, 0);
  const execute = process.argv.includes('--enqueue') || process.argv.includes('--execute');
  assertTaskCategoryBackfillModeEnabled(execute);
  if (execute && offset !== 0) {
    throw new Error(
      'Execute batches always resume at offset 0 because completed rows leave the candidate set',
    );
  }
  const db = getDb();
  const scope = withTeam(db, teamId, ZERO_UUID, { skipMembershipCheck: true });
  const [rows, projectAudit] = await Promise.all([
    scope.objects.listObjects({
      type: 'task',
      archived: false,
      taskCategoryNull: true,
      taskCategoryBackfillEligible: true,
      limit,
      offset,
    }),
    scope.objects.auditTaskPrimaryProjectEdges(),
  ]);

  const estimatedCostUsd = Number((rows.length * ESTIMATED_COST_USD_PER_TASK).toFixed(6));
  const report = {
    mode: execute ? 'enqueue' : 'dry-run',
    teamId,
    candidates: rows.length,
    limit,
    offset,
    nextDryRunOffset: offset + rows.length,
    resumeExecuteOffset: 0,
    estimatedInputTokens: rows.length * ESTIMATED_INPUT_TOKENS_PER_TASK,
    estimatedOutputTokens: rows.length * ESTIMATED_OUTPUT_TOKENS_PER_TASK,
    estimatedCostUsd,
    estimateOnly: true,
    ambiguousPrimaryProjectTaskIds: projectAudit.ambiguousTaskIds,
    ambiguousPrimaryProjectTasksTruncated: projectAudit.hasMore,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!execute) return;
  if (projectAudit.ambiguousTaskIds.length > 0) {
    throw new Error('Resolve tasks with multiple primary-project edges before enqueueing backfill');
  }
  const maxCostArgument = argument('--max-cost-usd');
  const maxCostUsd = Number(maxCostArgument);
  if (maxCostArgument === null || !Number.isFinite(maxCostUsd) || maxCostUsd < 0) {
    throw new Error('Enqueue requires --max-cost-usd <amount>');
  }
  if (estimatedCostUsd > maxCostUsd) {
    throw new Error(`Projected cost $${estimatedCostUsd} exceeds --max-cost-usd $${maxCostUsd}`);
  }
  const maxQueueAgeSeconds = Math.max(Number(argument('--max-queue-age-seconds') ?? '300'), 1);
  const [oldestWaiting] = await queue.getTaskCategoryQueue().getWaiting(0, 0);
  if (
    oldestWaiting?.timestamp &&
    Date.now() - oldestWaiting.timestamp > maxQueueAgeSeconds * 1000
  ) {
    throw new Error(
      `Task category queue is older than ${maxQueueAgeSeconds}s; pause backfill until it recovers`,
    );
  }

  const result = await enqueueTaskCategoryBackfillBatch(
    rows.map((task) => task.id),
    { enqueue: (taskId) => scope.objects.enqueueTaskCategoryBackfill(taskId) },
  );
  process.stdout.write(`${JSON.stringify({ teamId, ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(closeTaskCategoryBackfillResources);
}
