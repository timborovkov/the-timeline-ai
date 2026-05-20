/**
 * Re-embed script (Phase 5).
 *
 * Walks raw_events (team-scoped, visibility='team') and their facts and
 * enqueues embed jobs. Mirrors the reextract script shape:
 *   - cursor-based pagination on (occurred_at, id) — stable across ties
 *   - --team is required; cross-team re-embed is intentionally out of scope
 *   - --limit caps total enqueues; the SELECT page size is fixed
 *   - --dry-run prints what would happen without enqueueing
 *   - --target-collection writes points into a named collection; the embed
 *     worker honors this and the new collection lives alongside the old
 *     during cutover
 *   - --skip-facts only enqueues event-level embeds (useful when only the
 *     event-body model changed; rare)
 *
 * Idempotency comes from deterministic Qdrant point ids
 * (sha256(scope:sourceId:model)). Re-running this script is safe.
 *
 * Requires DATABASE_URL and REDIS_URL. OPENROUTER_API_KEY and QDRANT_URL
 * are checked at the worker, not here.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reembed -- \
 *     --team=<uuid> \
 *     [--target-collection=<name>] \
 *     [--limit=N] [--dry-run] [--skip-facts]
 */
import { closeDb, facts as factsTable, getDb, rawEvents } from '@timeline/db';
import { queue } from '@timeline/shared';
import { and, asc, eq, gt, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;

interface Args {
  teamId: string;
  limit: number;
  dryRun: boolean;
  targetCollection?: string;
  skipFacts: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  let targetCollection: string | undefined;
  let skipFacts = false;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--target-collection=')) {
      targetCollection = arg.slice('--target-collection='.length);
    } else if (arg === '--skip-facts') {
      skipFacts = true;
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: reembed --team=<uuid> [--target-collection=<name>] [--limit=N] [--dry-run] [--skip-facts]',
    );
    process.exit(2);
  }
  const result: Args = { teamId, limit, dryRun, skipFacts };
  if (targetCollection) result.targetCollection = targetCollection;
  return result;
}

async function enqueueEvents(args: Args): Promise<{ scanned: number; enqueued: number }> {
  const db = getDb();
  let cursor: { occurredAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < args.limit) {
    const conditions: SQL[] = [
      eq(rawEvents.teamId, args.teamId),
      eq(rawEvents.visibility, 'team'),
    ];
    if (cursor) {
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
      if (!args.dryRun) {
        const job: Parameters<typeof queue.enqueueEmbedJob>[0] = {
          rawEventId: row.id,
          teamId: args.teamId,
        };
        if (args.targetCollection) job.targetCollection = args.targetCollection;
        await queue.enqueueEmbedJob(job);
      }
      enqueued += 1;
      if (enqueued >= args.limit) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { occurredAt: last.occurredAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }

  return { scanned, enqueued };
}

async function enqueueFacts(args: Args, remaining: number): Promise<{ scanned: number; enqueued: number }> {
  if (remaining <= 0) return { scanned: 0, enqueued: 0 };
  const db = getDb();
  let cursor: string | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < remaining) {
    const conditions: SQL[] = [eq(factsTable.teamId, args.teamId)];
    if (cursor) conditions.push(gt(factsTable.id, cursor));

    const page: { id: string; rawEventId: string }[] = await db
      .select({ id: factsTable.id, rawEventId: factsTable.rawEventId })
      .from(factsTable)
      .innerJoin(rawEvents, eq(factsTable.rawEventId, rawEvents.id))
      .where(and(...conditions, eq(rawEvents.visibility, 'team')))
      .orderBy(asc(factsTable.id))
      .limit(PAGE_SIZE);

    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
      if (!args.dryRun) {
        const job: Parameters<typeof queue.enqueueEmbedJob>[0] = {
          rawEventId: row.rawEventId,
          teamId: args.teamId,
          factId: row.id,
        };
        if (args.targetCollection) job.targetCollection = args.targetCollection;
        await queue.enqueueEmbedJob(job);
      }
      enqueued += 1;
      if (enqueued >= remaining) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = last.id;
    if (page.length < PAGE_SIZE) break;
  }

  return { scanned, enqueued };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[reembed] team=${args.teamId} target=${args.targetCollection ?? '(default)'} limit=${
      Number.isFinite(args.limit) ? args.limit : 'unbounded'
    } skipFacts=${args.skipFacts} dryRun=${args.dryRun}`,
  );

  const events = await enqueueEvents(args);
  console.log(`[reembed] events scanned=${events.scanned} enqueued=${events.enqueued}`);

  const factBudget = args.skipFacts ? 0 : args.limit - events.enqueued;
  const facts = args.skipFacts
    ? { scanned: 0, enqueued: 0 }
    : await enqueueFacts(args, Number.isFinite(factBudget) ? factBudget : Number.POSITIVE_INFINITY);
  console.log(`[reembed] facts scanned=${facts.scanned} enqueued=${facts.enqueued}`);

  console.log(
    `[reembed] done. total enqueued=${events.enqueued + facts.enqueued}${
      args.dryRun ? ' (dry-run, no jobs queued)' : ''
    }`,
  );

  await queue.closeEmbedQueue();
  await queue.closeRedisConnection();
  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[reembed] failed', err);
  process.exit(1);
});
