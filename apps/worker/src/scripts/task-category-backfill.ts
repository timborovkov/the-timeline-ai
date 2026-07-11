import { closeDb, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';
import { getEnv } from '@timeline/shared/env';
import { withTeam } from '@timeline/shared/team-scope';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTIMATED_INPUT_TOKENS_PER_TASK = 220;
const ESTIMATED_OUTPUT_TOKENS_PER_TASK = 20;
const ESTIMATED_COST_USD_PER_TASK = 0.0002;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : null;
}

async function main(): Promise<void> {
  if (!getEnv().TASK_CATEGORY_CLASSIFICATION_ENABLED || !getEnv().TASK_CATEGORY_BACKFILL_ENABLED) {
    throw new Error('Task category classification is disabled by the operational kill switch');
  }
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
  if (execute && offset !== 0) {
    throw new Error(
      'Execute batches always resume at offset 0 because completed rows leave the candidate set',
    );
  }
  const db = getDb();
  const scope = withTeam(db, teamId, ZERO_UUID, { skipMembershipCheck: true });
  const rows = await scope.objects.listObjects({
    type: 'task',
    archived: false,
    taskCategoryNull: true,
    taskCategoryBackfillEligible: true,
    limit,
    offset,
  });

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
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!execute) return;
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

  let enqueued = 0;
  let failed = 0;
  for (const task of rows) {
    try {
      await scope.objects.enqueueTaskCategoryBackfill(task.id);
      enqueued += 1;
    } catch (error) {
      failed += 1;
      process.stderr.write(
        `${JSON.stringify({ taskId: task.id, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    }
  }
  process.stdout.write(`${JSON.stringify({ teamId, enqueued, failed })}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
