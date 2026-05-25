/**
 * Re-embed script (Phase 5 + Phase 8 follow-ups).
 *
 * Walks every source kind for a team and enqueues embed jobs:
 *   - raw_events (event-body scope)
 *   - facts (statement scope)
 *   - entities (canonical name + aliases — Phase 8)
 *   - workspace objects (narrative — Phase 8)
 *   - object_notes (body — Phase 8)
 *   - object_changes (narrative summary — Phase 8)
 *
 * Mirrors the reextract script shape:
 *   - cursor-based pagination — stable across ties
 *   - --team is required; cross-team re-embed is intentionally out of scope
 *   - --limit caps total enqueues; the SELECT page size is fixed
 *   - --dry-run prints what would happen without enqueueing
 *   - --target-collection writes points into a named collection
 *   - --skip-* flags omit a specific kind
 *
 * Idempotency comes from deterministic Qdrant point ids
 * (sha256(scope:sourceId:model)). Re-running this script is safe.
 *
 * Requires DATABASE_URL and REDIS_URL.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reembed -- \
 *     --team=<uuid> \
 *     [--target-collection=<name>] \
 *     [--limit=N] [--dry-run] \
 *     [--skip-facts] [--skip-objects] [--skip-notes] [--skip-changes] [--skip-entities]
 */
import {
  closeDb,
  entities as entitiesTable,
  facts as factsTable,
  getDb,
  objectChanges as objectChangesTable,
  objectNotes as objectNotesTable,
  rawEvents,
} from '@timeline/db';
import { queue } from '@timeline/shared';
import { and, asc, eq, gt, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;

interface Args {
  teamId: string;
  limit: number;
  dryRun: boolean;
  targetCollection?: string;
  skipFacts: boolean;
  skipObjects: boolean;
  skipNotes: boolean;
  skipChanges: boolean;
  skipEntities: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  let targetCollection: string | undefined;
  let skipFacts = false;
  let skipObjects = false;
  let skipNotes = false;
  let skipChanges = false;
  let skipEntities = false;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--target-collection=')) {
      targetCollection = arg.slice('--target-collection='.length);
    } else if (arg === '--skip-facts') skipFacts = true;
    else if (arg === '--skip-objects') skipObjects = true;
    else if (arg === '--skip-notes') skipNotes = true;
    else if (arg === '--skip-changes') skipChanges = true;
    else if (arg === '--skip-entities') skipEntities = true;
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: reembed --team=<uuid> [--target-collection=<name>] [--limit=N] [--dry-run]\n' +
        '                 [--skip-facts] [--skip-objects] [--skip-notes] [--skip-changes] [--skip-entities]',
    );
    process.exit(2);
  }
  const result: Args = {
    teamId,
    limit,
    dryRun,
    skipFacts,
    skipObjects,
    skipNotes,
    skipChanges,
    skipEntities,
  };
  if (targetCollection) result.targetCollection = targetCollection;
  return result;
}

interface PhaseResult {
  scanned: number;
  enqueued: number;
}

async function enqueueEvents(args: Args, budget: number): Promise<PhaseResult> {
  if (budget <= 0) return { scanned: 0, enqueued: 0 };
  const db = getDb();
  let cursor: { occurredAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < budget) {
    const conditions: SQL[] = [
      eq(rawEvents.teamId, args.teamId),
      eq(rawEvents.visibility, 'team'),
      isNotNull(rawEvents.contentText),
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
        const job: queue.EmbedRawEventJobData = {
          scope: 'raw_event',
          rawEventId: row.id,
          teamId: args.teamId,
        };
        if (args.targetCollection) job.targetCollection = args.targetCollection;
        await queue.enqueueEmbedJob(job);
      }
      enqueued += 1;
      if (enqueued >= budget) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { occurredAt: last.occurredAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, enqueued };
}

async function enqueueFacts(args: Args, budget: number): Promise<PhaseResult> {
  if (budget <= 0) return { scanned: 0, enqueued: 0 };
  const db = getDb();
  let cursor: string | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < budget) {
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
        const job: queue.EmbedFactJobData = {
          scope: 'fact',
          rawEventId: row.rawEventId,
          teamId: args.teamId,
          factId: row.id,
        };
        if (args.targetCollection) job.targetCollection = args.targetCollection;
        await queue.enqueueEmbedJob(job);
      }
      enqueued += 1;
      if (enqueued >= budget) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = last.id;
    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, enqueued };
}

/**
 * Page through a table by (updatedAt, id), enqueueing one job per row via the
 * caller-supplied builder. Pulled out so each Phase 8 kind doesn't re-roll
 * the same cursor loop.
 */
async function enqueueByUpdatedAt(args: {
  teamId: string;
  budget: number;
  dryRun: boolean;
  fetchPage: (cursor: { updatedAt: Date; id: string } | null) => Promise<
    { id: string; updatedAt: Date }[]
  >;
  enqueueRow: (id: string) => Promise<void>;
}): Promise<PhaseResult> {
  if (args.budget <= 0) return { scanned: 0, enqueued: 0 };
  let cursor: { updatedAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;
  while (enqueued < args.budget) {
    const page = await args.fetchPage(cursor);
    if (page.length === 0) break;
    for (const row of page) {
      scanned += 1;
      if (!args.dryRun) await args.enqueueRow(row.id);
      enqueued += 1;
      if (enqueued >= args.budget) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { updatedAt: last.updatedAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, enqueued };
}

async function enqueueObjects(args: Args, budget: number): Promise<PhaseResult> {
  const db = getDb();
  return enqueueByUpdatedAt({
    teamId: args.teamId,
    budget,
    dryRun: args.dryRun,
    async fetchPage(cursor) {
      const conditions: SQL[] = [
        eq(entitiesTable.teamId, args.teamId),
        isNull(entitiesTable.mergedIntoId),
      ];
      if (cursor) {
        const c = or(
          sql`${entitiesTable.updatedAt} > ${cursor.updatedAt.toISOString()}::timestamptz`,
          and(
            sql`${entitiesTable.updatedAt} = ${cursor.updatedAt.toISOString()}::timestamptz`,
            gt(entitiesTable.id, cursor.id),
          ),
        );
        if (c) conditions.push(c);
      }
      return db
        .select({ id: entitiesTable.id, updatedAt: entitiesTable.updatedAt })
        .from(entitiesTable)
        .where(and(...conditions))
        .orderBy(asc(entitiesTable.updatedAt), asc(entitiesTable.id))
        .limit(PAGE_SIZE);
    },
    async enqueueRow(id) {
      await queue.enqueueObjectEmbedJob(args.teamId, id, args.targetCollection ? { targetCollection: args.targetCollection } : {});
    },
  });
}

async function enqueueEntities(args: Args, budget: number): Promise<PhaseResult> {
  const db = getDb();
  return enqueueByUpdatedAt({
    teamId: args.teamId,
    budget,
    dryRun: args.dryRun,
    async fetchPage(cursor) {
      const conditions: SQL[] = [
        eq(entitiesTable.teamId, args.teamId),
        isNull(entitiesTable.mergedIntoId),
      ];
      if (cursor) {
        const c = or(
          sql`${entitiesTable.updatedAt} > ${cursor.updatedAt.toISOString()}::timestamptz`,
          and(
            sql`${entitiesTable.updatedAt} = ${cursor.updatedAt.toISOString()}::timestamptz`,
            gt(entitiesTable.id, cursor.id),
          ),
        );
        if (c) conditions.push(c);
      }
      return db
        .select({ id: entitiesTable.id, updatedAt: entitiesTable.updatedAt })
        .from(entitiesTable)
        .where(and(...conditions))
        .orderBy(asc(entitiesTable.updatedAt), asc(entitiesTable.id))
        .limit(PAGE_SIZE);
    },
    async enqueueRow(id) {
      await queue.enqueueEntityEmbedJob(args.teamId, id, args.targetCollection ? { targetCollection: args.targetCollection } : {});
    },
  });
}

async function enqueueNotes(args: Args, budget: number): Promise<PhaseResult> {
  const db = getDb();
  return enqueueByUpdatedAt({
    teamId: args.teamId,
    budget,
    dryRun: args.dryRun,
    async fetchPage(cursor) {
      const conditions: SQL[] = [
        eq(objectNotesTable.teamId, args.teamId),
        isNull(objectNotesTable.deletedAt),
      ];
      if (cursor) {
        const c = or(
          sql`${objectNotesTable.updatedAt} > ${cursor.updatedAt.toISOString()}::timestamptz`,
          and(
            sql`${objectNotesTable.updatedAt} = ${cursor.updatedAt.toISOString()}::timestamptz`,
            gt(objectNotesTable.id, cursor.id),
          ),
        );
        if (c) conditions.push(c);
      }
      return db
        .select({ id: objectNotesTable.id, updatedAt: objectNotesTable.updatedAt })
        .from(objectNotesTable)
        .where(and(...conditions))
        .orderBy(asc(objectNotesTable.updatedAt), asc(objectNotesTable.id))
        .limit(PAGE_SIZE);
    },
    async enqueueRow(id) {
      await queue.enqueueObjectNoteEmbedJob(args.teamId, id, args.targetCollection ? { targetCollection: args.targetCollection } : {});
    },
  });
}

async function enqueueChanges(args: Args, budget: number): Promise<PhaseResult> {
  // object_changes is append-only — page by (changedAt, id). The shared
  // enqueueByUpdatedAt helper keys on `updatedAt`, so adapt the shape.
  if (budget <= 0) return { scanned: 0, enqueued: 0 };
  const db = getDb();
  let cursor: { changedAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;
  while (enqueued < budget) {
    const conditions: SQL[] = [eq(objectChangesTable.teamId, args.teamId)];
    if (cursor) {
      const c = or(
        sql`${objectChangesTable.changedAt} > ${cursor.changedAt.toISOString()}::timestamptz`,
        and(
          sql`${objectChangesTable.changedAt} = ${cursor.changedAt.toISOString()}::timestamptz`,
          gt(objectChangesTable.id, cursor.id),
        ),
      );
      if (c) conditions.push(c);
    }
    const page: { id: string; changedAt: Date }[] = await db
      .select({ id: objectChangesTable.id, changedAt: objectChangesTable.changedAt })
      .from(objectChangesTable)
      .where(and(...conditions))
      .orderBy(asc(objectChangesTable.changedAt), asc(objectChangesTable.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      scanned += 1;
      if (!args.dryRun) {
        await queue.enqueueObjectChangeEmbedJob(
          args.teamId,
          row.id,
          args.targetCollection ? { targetCollection: args.targetCollection } : {},
        );
      }
      enqueued += 1;
      if (enqueued >= budget) break;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { changedAt: last.changedAt, id: last.id };
    if (page.length < PAGE_SIZE) break;
  }
  return { scanned, enqueued };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[reembed] team=${args.teamId} target=${args.targetCollection ?? '(default)'} limit=${
      Number.isFinite(args.limit) ? args.limit : 'unbounded'
    } skip={facts:${args.skipFacts},objects:${args.skipObjects},notes:${args.skipNotes},changes:${args.skipChanges},entities:${args.skipEntities}} dryRun=${args.dryRun}`,
  );

  function remaining(used: number): number {
    if (!Number.isFinite(args.limit)) return Number.POSITIVE_INFINITY;
    return Math.max(0, args.limit - used);
  }

  let totalEnqueued = 0;

  const events = await enqueueEvents(args, remaining(totalEnqueued));
  totalEnqueued += events.enqueued;
  console.log(`[reembed] events scanned=${events.scanned} enqueued=${events.enqueued}`);

  const facts = args.skipFacts
    ? { scanned: 0, enqueued: 0 }
    : await enqueueFacts(args, remaining(totalEnqueued));
  totalEnqueued += facts.enqueued;
  console.log(`[reembed] facts scanned=${facts.scanned} enqueued=${facts.enqueued}`);

  const objs = args.skipObjects
    ? { scanned: 0, enqueued: 0 }
    : await enqueueObjects(args, remaining(totalEnqueued));
  totalEnqueued += objs.enqueued;
  console.log(`[reembed] objects scanned=${objs.scanned} enqueued=${objs.enqueued}`);

  const notes = args.skipNotes
    ? { scanned: 0, enqueued: 0 }
    : await enqueueNotes(args, remaining(totalEnqueued));
  totalEnqueued += notes.enqueued;
  console.log(`[reembed] notes scanned=${notes.scanned} enqueued=${notes.enqueued}`);

  const changes = args.skipChanges
    ? { scanned: 0, enqueued: 0 }
    : await enqueueChanges(args, remaining(totalEnqueued));
  totalEnqueued += changes.enqueued;
  console.log(`[reembed] changes scanned=${changes.scanned} enqueued=${changes.enqueued}`);

  const ents = args.skipEntities
    ? { scanned: 0, enqueued: 0 }
    : await enqueueEntities(args, remaining(totalEnqueued));
  totalEnqueued += ents.enqueued;
  console.log(`[reembed] entities scanned=${ents.scanned} enqueued=${ents.enqueued}`);

  console.log(
    `[reembed] done. total enqueued=${totalEnqueued}${args.dryRun ? ' (dry-run, no jobs queued)' : ''}`,
  );

  await queue.closeEmbedQueue();
  await queue.closeRedisConnection();
  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[reembed] failed', err);
  process.exit(1);
});
