/**
 * Re-extraction script. Walks raw_events for a team and enqueues an extract
 * job for any row that lacks facts at the current model_version. Idempotent:
 * rows already at the current version are skipped; the worker itself also
 * re-checks before doing any LLM work.
 *
 * Pagination is cursor-based on (occurred_at, id) so the script reliably
 * processes every event for the team, not just the first --limit. The
 * --limit flag now caps total enqueues, not the SELECT page size.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reextract -- --team=<teamId> [--limit=N] [--dry-run]
 *
 * Requires DATABASE_URL and REDIS_URL. OPENROUTER_API_KEY is required at
 * extraction time (in the worker), not here.
 */
import { closeDb, facts as factsTable, getDb, rawEvents } from '@timeline/db';
import { getEnv, queue } from '@timeline/shared';
import { and, asc, eq, gt, isNotNull, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXTRACTION_CODE_VERSION = '2026-05-a';
const PAGE_SIZE = 500;

function parseArgs(): { teamId: string; limit: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error('Usage: reextract --team=<uuid> [--limit=N] [--dry-run]');
    process.exit(2);
  }
  return { teamId, limit, dryRun };
}

async function main(): Promise<void> {
  const { teamId, limit, dryRun } = parseArgs();
  const env = getEnv();
  const modelId = env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
  const modelVersion = `${modelId}@${EXTRACTION_CODE_VERSION}`;
  console.log(
    `[reextract] team=${teamId} modelVersion=${modelVersion} limit=${
      Number.isFinite(limit) ? limit : 'unbounded'
    } dryRun=${dryRun}`,
  );

  const db = getDb();
  let cursor: { occurredAt: Date; id: string } | null = null;
  let enqueued = 0;
  let skipped = 0;
  let scanned = 0;

  while (enqueued < limit) {
    const conditions: SQL[] = [
      eq(rawEvents.teamId, teamId),
      isNotNull(rawEvents.contentText),
    ];
    if (cursor) {
      // Compound cursor: rows strictly after (occurredAt, id) of the last
      // row we saw. The composite ordering keeps the pagination stable
      // across ties on occurredAt (id is unique).
      const cursorClause = or(
        sql`${rawEvents.occurredAt} > ${cursor.occurredAt.toISOString()}::timestamptz`,
        and(
          sql`${rawEvents.occurredAt} = ${cursor.occurredAt.toISOString()}::timestamptz`,
          gt(rawEvents.id, cursor.id),
        ),
      );
      if (cursorClause) conditions.push(cursorClause);
    }

    const page: { id: string; occurredAt: Date }[] = await db
      .select({ id: rawEvents.id, occurredAt: rawEvents.occurredAt })
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.id))
      .limit(PAGE_SIZE);

    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
      const existing = await db
        .select({ id: factsTable.id })
        .from(factsTable)
        .where(and(eq(factsTable.rawEventId, row.id), eq(factsTable.modelVersion, modelVersion)))
        .limit(1);
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }
      if (!dryRun) {
        await queue.enqueueExtractJob({ rawEventId: row.id, teamId });
      }
      enqueued += 1;
      if (enqueued >= limit) break;
    }

    const last = page[page.length - 1];
    if (!last) break;
    cursor = { occurredAt: last.occurredAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }

  console.log(
    `[reextract] done. scanned=${scanned} enqueued=${enqueued} skipped=${skipped}${
      dryRun ? ' (dry-run, no jobs queued)' : ''
    }`,
  );

  await queue.closeExtractQueue();
  await queue.closeRedisConnection();
  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[reextract] failed', err);
  process.exit(1);
});
