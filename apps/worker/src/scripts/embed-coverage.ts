/**
 * Embed coverage audit.
 *
 * For a given team, count rows in each source-of-truth table (filtered to
 * what the embed worker actually indexes) and compare against the count of
 * Qdrant points carrying that `source_kind` payload value. Reports per-kind
 * drift. Exits non-zero when drift exceeds the threshold so a CI / cron run
 * can fail loudly.
 *
 * What "drift" means here: source rows that exist but have no corresponding
 * Qdrant point (point count < row count). The reverse — Qdrant points with
 * no source row — can happen briefly between a soft-delete and a deletion
 * sweep, and is not flagged as an error.
 *
 * Caveats:
 *   - raw_event / fact pre-Phase-8 points lack the `source_kind` payload
 *     field. Until those points are re-upserted (run reembed), the count for
 *     those kinds will under-report. The audit prints a hint when this
 *     happens. Phase 8 kinds (object, object_note, object_change, entity)
 *     always stamp source_kind, so their counts are reliable.
 *
 * Usage:
 *   pnpm --filter @timeline/worker embed-coverage -- --team=<uuid> \
 *     [--threshold=0.01]   # default 1%
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
import { qdrant } from '@timeline/shared';
import { and, count, eq, isNotNull, isNull, not, or, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Args {
  teamId: string;
  threshold: number;
}

function parseArgs(): Args {
  let teamId: string | undefined;
  let threshold = 0.01;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--threshold=')) {
      const v = Number.parseFloat(arg.slice('--threshold='.length));
      if (Number.isFinite(v) && v >= 0) threshold = v;
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error('Usage: embed-coverage --team=<uuid> [--threshold=0.01]');
    process.exit(2);
  }
  return { teamId, threshold };
}

interface KindReport {
  kind: qdrant.SourceKind;
  rows: number;
  points: number;
}

async function countTeamRows(teamId: string): Promise<Record<qdrant.SourceKind, number>> {
  const db = getDb();
  // entities backs both `object` and `entity` source kinds — same row, two
  // point types. One query feeds both counts.
  const [rawEventRows, factRows, entityRows, noteRows, changeRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(rawEvents.visibility, 'team'),
          isNotNull(rawEvents.contentText),
        ),
      ),
    db
      .select({ n: count() })
      .from(factsTable)
      .innerJoin(rawEvents, eq(factsTable.rawEventId, rawEvents.id))
      .where(and(eq(factsTable.teamId, teamId), eq(rawEvents.visibility, 'team'))),
    db
      .select({ n: count() })
      .from(entitiesTable)
      .where(and(eq(entitiesTable.teamId, teamId), isNull(entitiesTable.mergedIntoId))),
    db
      .select({ n: count() })
      .from(objectNotesTable)
      .where(and(eq(objectNotesTable.teamId, teamId), isNull(objectNotesTable.deletedAt))),
    // Mirror buildObjectChangePlan: rows with field starting `__` AND no
    // operator `note` are intentionally skipped by the worker (the parent
    // raw_events row carries the human narrative). Counting them would
    // create permanent positive drift for healthy teams.
    db
      .select({ n: count() })
      .from(objectChangesTable)
      .where(
        and(
          eq(objectChangesTable.teamId, teamId),
          or(
            not(sql`${objectChangesTable.field} LIKE '\\_\\_%' ESCAPE '\\'`),
            isNotNull(objectChangesTable.note),
          ),
        ),
      ),
  ]);

  const entityCount = entityRows[0]?.n ?? 0;
  return {
    raw_event: rawEventRows[0]?.n ?? 0,
    fact: factRows[0]?.n ?? 0,
    object: entityCount,
    object_note: noteRows[0]?.n ?? 0,
    object_change: changeRows[0]?.n ?? 0,
    entity: entityCount,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[embed-coverage] team=${args.teamId} threshold=${args.threshold}`);

  const rowCounts = await countTeamRows(args.teamId);
  const client = qdrant.getQdrantClient();
  const kinds: qdrant.SourceKind[] = [
    'raw_event',
    'fact',
    'object',
    'object_note',
    'object_change',
    'entity',
  ];
  const reports: KindReport[] = [];
  for (const kind of kinds) {
    const points = await client.countPoints(args.teamId, { sourceKind: kind });
    reports.push({ kind, rows: rowCounts[kind], points });
  }

  let exitCode = 0;
  console.log('');
  console.log('kind            rows        points      drift   drift%');
  console.log('-----------     ---------   ---------   -----   ------');
  for (const r of reports) {
    const drift = r.rows - r.points;
    const driftPct = r.rows > 0 ? drift / r.rows : 0;
    const flag = drift > 0 && driftPct > args.threshold ? '⚠' : ' ';
    console.log(
      `${flag} ${r.kind.padEnd(13)} ${String(r.rows).padStart(9)}   ${String(r.points).padStart(9)}   ${String(drift).padStart(5)}   ${(driftPct * 100).toFixed(2).padStart(5)}%`,
    );
    if (drift > 0 && driftPct > args.threshold) exitCode = 1;
  }

  console.log('');
  if (exitCode !== 0) {
    console.log(
      `[embed-coverage] drift exceeded threshold. Run: pnpm --filter @timeline/worker reembed -- --team=${args.teamId}`,
    );
  } else {
    console.log('[embed-coverage] coverage within threshold');
  }

  await closeDb();
  process.exit(exitCode);
}

main().catch((err: unknown) => {
  console.error('[embed-coverage] failed', err);
  process.exit(1);
});
