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
import { closeDb, getDb, rawEvents } from '@timeline/db';
import { queue } from '@timeline/shared';
import { currentExtractionModelVersions } from '@timeline/shared/extraction-model-version';
import { and, asc, eq, gt, isNotNull, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const modelVersions = currentExtractionModelVersions();
  console.log(
    `[reextract] team=${teamId} modelVersions=${modelVersions.join(',')} limit=${
      Number.isFinite(limit) ? limit : 'unbounded'
    } dryRun=${dryRun}`,
  );

  const db = getDb();
  let cursor: { occurredAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < limit) {
    const conditions: SQL[] = [eq(rawEvents.teamId, teamId), isNotNull(rawEvents.contentText)];
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

    // Filter by the metadata stamp in SQL so we never enqueue a job the
    // worker would just skip. Mirrors the worker's idempotency check: a row
    // whose source_metadata.extraction_model_version already matches any
    // current extraction route does not need re-processing — including
    // zero-fact runs, which a facts-existence check would falsely re-enqueue.
    const currentVersionValues = modelVersions.map((version) => sql`${version}`);
    const stampCondition = sql`COALESCE(${rawEvents.sourceMetadata} ->> 'extraction_model_version', '') NOT IN (${sql.join(currentVersionValues, sql`, `)})`;
    conditions.push(stampCondition);

    const page: { id: string; occurredAt: Date }[] = await db
      .select({ id: rawEvents.id, occurredAt: rawEvents.occurredAt })
      .from(rawEvents)
      .where(and(...conditions))
      .orderBy(asc(rawEvents.occurredAt), asc(rawEvents.id))
      .limit(PAGE_SIZE);

    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
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
    `[reextract] done. scanned=${scanned} enqueued=${enqueued}${
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
