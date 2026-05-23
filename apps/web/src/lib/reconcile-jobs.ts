import { facts as factsTable, rawEvents } from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';
import { and, eq, isNotNull, isNull, lt, notExists, sql } from 'drizzle-orm';

import { db } from './db';

const log = childLogger('web:reconcile-jobs');

/** Default cutoff: only events idle this long count as orphaned. */
const STALE_MS = 15 * 60 * 1000;
/** Bound per-run cost so a reconciler crash never blows up the queue. */
const BATCH_LIMIT = 200;
/**
 * Cap re-enqueue attempts per (row, stage). Without this, a deterministically
 * broken row (corrupt audio, missing S3 object, model bug) would re-enqueue
 * every 15 min forever — worker-side idempotency protects DB correctness but
 * NOT API/LLM cost. After this many tries we stamp `reconcile_giveup_<stage>`
 * and skip the row on subsequent runs; admin can clear the marker to retry.
 */
const MAX_RECONCILE_ATTEMPTS = 3;

interface ReconcileResult {
  transcribeReenqueued: number;
  extractReenqueued: number;
  embedReenqueued: number;
  /**
   * Count of rows currently dead-lettered (any stage past
   * MAX_RECONCILE_ATTEMPTS). Surfaced for operational dashboards — operators
   * can clear `reconcile_giveup_<stage>` from `source_metadata` to retry.
   */
  deadLettered: number;
  errors: string[];
}

/**
 * Build the SQL fragment that filters out rows past the attempt cap for a
 * given stage. The counter lives at `source_metadata.reconcile_attempts_<stage>`
 * as a stringified int (JSONB doesn't distinguish int from text well across
 * dialects, so we cast explicitly).
 */
function attemptsBelowCap(stage: 'transcribe' | 'extract' | 'embed') {
  const key = `reconcile_attempts_${stage}`;
  // COALESCE source_metadata → '{}'::jsonb defensively. The column is
  // declared NOT NULL with default '{}', so this is structurally impossible
  // today — match the worker-side pattern (transcribe.ts, embed.ts) for
  // resilience against future schema drift / pre-constraint legacy rows.
  return sql`COALESCE((COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ->> ${key})::int, 0) < ${MAX_RECONCILE_ATTEMPTS}`;
}

/**
 * Bump the per-stage attempt counter for a single row. Done in one UPDATE so
 * a crash between enqueue and bump means we re-try (safer than over-counting).
 * When the counter reaches the cap, we also stamp `reconcile_giveup_<stage>`
 * with an ISO timestamp so operators can see when a row was dead-lettered.
 */
async function bumpAttempts(
  rawEventId: string,
  stage: 'transcribe' | 'extract' | 'embed',
): Promise<void> {
  const key = `reconcile_attempts_${stage}`;
  const giveupKey = `reconcile_giveup_${stage}`;
  // Read-modify-write in a single statement using jsonb concat. The CASE
  // stamps a giveup marker when the bumped value equals the cap.
  await db
    .update(rawEvents)
    .set({
      // COALESCE the outer column reference too — without it, a NULL row
      // makes the whole concat NULL and the counter never advances,
      // silently bypassing the dead-letter cap.
      sourceMetadata: sql`
        COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ||
        jsonb_build_object(
          ${key}, COALESCE((COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ->> ${key})::int, 0) + 1,
          ${giveupKey},
          CASE
            WHEN COALESCE((COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ->> ${key})::int, 0) + 1 >= ${MAX_RECONCILE_ATTEMPTS}
            THEN to_jsonb(now()::text)
            ELSE COALESCE(${rawEvents.sourceMetadata} -> ${giveupKey}, 'null'::jsonb)
          END
        )
      `,
    })
    .where(eq(rawEvents.id, rawEventId));
}

/**
 * Find raw_events whose downstream job appears to have been lost (queue
 * failure, worker crash mid-flight, redis evict) and re-enqueue. Workers are
 * already idempotent — deterministic UPDATEs on raw_events, deterministic
 * Qdrant point ids on embed — so a duplicate enqueue here is a no-op cost
 * (one extra LLM call), not a correctness bug.
 *
 * `now` is injectable so tests can scrub the staleness window.
 */
export async function reconcileOrphanedJobs(opts: { now?: Date } = {}): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - STALE_MS);
  const result: ReconcileResult = {
    transcribeReenqueued: 0,
    extractReenqueued: 0,
    embedReenqueued: 0,
    deadLettered: 0,
    errors: [],
  };

  // One cheap query for dashboard visibility: how many rows are currently
  // dead-lettered across any stage. Operators can clear a `reconcile_giveup_*`
  // key from source_metadata to retry a specific row.
  try {
    const counted = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rawEvents)
      .where(
        sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ?| array['reconcile_giveup_transcribe','reconcile_giveup_extract','reconcile_giveup_embed']`,
      );
    result.deadLettered = counted[0]?.count ?? 0;
  } catch (err) {
    // Non-fatal: visibility metric only, the actual reconcile logic still runs.
    log.warn({ err: (err as Error).message }, 'dead_letter_count_failed');
  }

  // 1. Transcribe orphans: rows with an audio key but no transcript.
  try {
    const stuck = await db
      .select({ id: rawEvents.id, teamId: rawEvents.teamId, audioKey: rawEvents.contentAudioUrl })
      .from(rawEvents)
      .where(
        and(
          isNotNull(rawEvents.contentAudioUrl),
          isNull(rawEvents.contentText),
          lt(rawEvents.createdAt, staleCutoff),
          attemptsBelowCap('transcribe'),
        ),
      )
      .limit(BATCH_LIMIT);

    const transcribeQueue = queue.getTranscribeQueue();
    const inflight = await collectInflightRawEventIds(transcribeQueue);
    for (const row of stuck) {
      if (!row.audioKey || inflight.has(row.id)) continue;
      await queue.enqueueTranscribeJob({
        rawEventId: row.id,
        teamId: row.teamId,
        audioKey: row.audioKey,
      });
      await bumpAttempts(row.id, 'transcribe');
      result.transcribeReenqueued += 1;
    }
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'transcribe_reconcile_failed');
    result.errors.push(`transcribe: ${msg}`);
  }

  // 2. Extract orphans: rows with text but no facts and no inflight extract.
  try {
    const stuck = await db
      .select({ id: rawEvents.id, teamId: rawEvents.teamId })
      .from(rawEvents)
      .where(
        and(
          isNotNull(rawEvents.contentText),
          lt(rawEvents.createdAt, staleCutoff),
          notExists(
            db
              .select({ one: sql`1` })
              .from(factsTable)
              .where(eq(factsTable.rawEventId, rawEvents.id)),
          ),
          attemptsBelowCap('extract'),
        ),
      )
      .limit(BATCH_LIMIT);

    const extractQueue = queue.getExtractQueue();
    const inflight = await collectInflightRawEventIds(extractQueue);
    for (const row of stuck) {
      if (inflight.has(row.id)) continue;
      await queue.enqueueExtractJob({ rawEventId: row.id, teamId: row.teamId });
      await bumpAttempts(row.id, 'extract');
      result.extractReenqueued += 1;
    }
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'extract_reconcile_failed');
    result.errors.push(`extract: ${msg}`);
  }

  // 3. Embed orphans: events with text but no `embedded_at` marker. The
  // event-scope embed stamps `source_metadata.embedded_at` on success;
  // absence past the staleness cutoff means the embed never landed.
  // (Per-fact embed status isn't tracked durably — re-running event-scope
  // embed is enough for the agent's search path; the existing reembed
  // script handles fact-scope backfill if it ever matters.)
  try {
    const stuck = await db
      .select({ id: rawEvents.id, teamId: rawEvents.teamId })
      .from(rawEvents)
      .where(
        and(
          isNotNull(rawEvents.contentText),
          lt(rawEvents.createdAt, staleCutoff),
          sql`NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'embedded_at')`,
          attemptsBelowCap('embed'),
        ),
      )
      .limit(BATCH_LIMIT);

    const embedQueue = queue.getEmbedQueue();
    const inflight = await collectInflightRawEventIds(embedQueue);
    for (const row of stuck) {
      if (inflight.has(row.id)) continue;
      await queue.enqueueEmbedJob({ rawEventId: row.id, teamId: row.teamId });
      await bumpAttempts(row.id, 'embed');
      result.embedReenqueued += 1;
    }
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err: msg }, 'embed_reconcile_failed');
    result.errors.push(`embed: ${msg}`);
  }

  log.info(result, 'reconcile_done');
  return result;
}

// Helpers: gather rawEventId / factId from already-queued jobs so we don't
// re-enqueue something the worker is about to pick up.

interface QueueLike {
  getJobs: (
    types: ('waiting' | 'active' | 'delayed')[],
    start?: number,
    end?: number,
  ) => Promise<{ data: { rawEventId?: string; factId?: string } }[]>;
}

async function collectInflightRawEventIds(q: QueueLike): Promise<Set<string>> {
  // Intentionally exclude `failed` — those jobs have exhausted retries and
  // won't be picked up by a worker on their own. Treating them as inflight
  // would mean the reconciler skips the exact rows it's meant to recover.
  const jobs = await q.getJobs(['waiting', 'active', 'delayed'], 0, 2000);
  return new Set(jobs.map((j) => j.data.rawEventId).filter((id): id is string => Boolean(id)));
}
