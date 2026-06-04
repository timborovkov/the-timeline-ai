/**
 * Embed coverage audit.
 *
 * For a given team, count rows in each source-of-truth table (filtered to
 * what the embed worker actually indexes) and compare against the count of
 * distinct Qdrant source ids carrying that `source_kind` payload value. Reports per-kind
 * drift. Exits non-zero when drift exceeds the threshold so a CI / cron run
 * can fail loudly.
 *
 * What "drift" means here: source rows that exist but have no corresponding
 * Qdrant source (source count < row count). The reverse — Qdrant sources with
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
  calendarEvents,
  closeDb,
  documentChunks,
  documents,
  entities as entitiesTable,
  facts as factsTable,
  getDb,
  meetings as meetingsTable,
  meetingTranscriptChunks,
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
  sources: number;
}

async function countTeamRows(teamId: string): Promise<Record<qdrant.SourceKind, number>> {
  const db = getDb();
  // entities backs both `object` and `entity` source kinds — same row, two
  // point types. One query feeds both counts.
  const [
    rawEventRows,
    factRows,
    entityRows,
    noteRows,
    changeRows,
    docChunkRows,
    meetingChunkRows,
    integrationEventRows,
    calendarEventRows,
  ] = await Promise.all([
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
    // Phase 9 doc_chunk: chunks whose parent document is active (not
    // soft-deleted), team-visible, and non-empty after trimming. Mirrors
    // buildDocChunkPlan's skip rules — soft-deleted/private docs and empty
    // chunks are intentionally not in Qdrant, so excluding them from the
    // row count keeps drift honest.
    db
      .select({ n: count() })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .where(
        and(
          eq(documentChunks.teamId, teamId),
          isNull(documents.deletedAt),
          eq(documents.visibility, 'team'),
          sql`length(trim(${documentChunks.text})) > 0`,
        ),
      ),
    // Phase 10 meeting_chunk: chunks whose parent meeting is team-visibility
    // and whose text is non-empty after trimming.
    db
      .select({ n: count() })
      .from(meetingTranscriptChunks)
      .innerJoin(meetingsTable, eq(meetingsTable.id, meetingTranscriptChunks.meetingId))
      .where(
        and(
          eq(meetingTranscriptChunks.teamId, teamId),
          eq(meetingsTable.defaultVisibility, 'team'),
          sql`length(trim(${meetingTranscriptChunks.text})) > 0`,
        ),
      ),
    // Phase 11 integration_event: subset of raw_events whose source is
    // 'integration'. These also count under raw_event above, but Qdrant
    // indexes them as source_kind='integration_event' so we track drift
    // for that kind separately.
    db
      .select({ n: count() })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(rawEvents.visibility, 'team'),
          isNotNull(rawEvents.contentText),
          eq(rawEvents.source, 'integration'),
        ),
      ),
    // Phase 11 calendar_event: only active, team-visible calendar events
    // are embedded by buildCalendarEventPlan.
    db
      .select({ n: count() })
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.teamId, teamId),
          isNull(calendarEvents.deletedAt),
          eq(calendarEvents.visibility, 'team'),
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
    doc_chunk: docChunkRows[0]?.n ?? 0,
    meeting_chunk: meetingChunkRows[0]?.n ?? 0,
    integration_event: integrationEventRows[0]?.n ?? 0,
    calendar_event: calendarEventRows[0]?.n ?? 0,
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
    'doc_chunk',
    'meeting_chunk',
    'integration_event',
    'calendar_event',
  ];
  const reports: KindReport[] = [];
  for (const kind of kinds) {
    const sources = await client.countDistinctSources(args.teamId, { sourceKind: kind });
    reports.push({ kind, rows: rowCounts[kind], sources });
  }

  let exitCode = 0;
  console.log('');
  console.log('kind            rows        sources     drift   drift%');
  console.log('-----------     ---------   ---------   -----   ------');
  for (const r of reports) {
    const drift = r.rows - r.sources;
    const driftPct = r.rows > 0 ? drift / r.rows : 0;
    const flag = drift > 0 && driftPct > args.threshold ? '⚠' : ' ';
    console.log(
      `${flag} ${r.kind.padEnd(13)} ${String(r.rows).padStart(9)}   ${String(r.sources).padStart(9)}   ${String(drift).padStart(5)}   ${(driftPct * 100).toFixed(2).padStart(5)}%`,
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
