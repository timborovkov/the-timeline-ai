import { facts as factsTable, rawEvents } from '@timeline/db';
import { childLogger, queue } from '@timeline/shared';
import { and, eq, isNotNull, isNull, lt, notExists, sql } from 'drizzle-orm';

import { db } from './db';

const log = childLogger('web:reconcile-jobs');

/** Default cutoff: only events idle this long count as orphaned. */
const STALE_MS = 15 * 60 * 1000;
/** Bound per-run cost so a reconciler crash never blows up the queue. */
const BATCH_LIMIT = 200;

export interface ReconcileResult {
  transcribeReenqueued: number;
  extractReenqueued: number;
  embedReenqueued: number;
  errors: string[];
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
    errors: [],
  };

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
        ),
      )
      .limit(BATCH_LIMIT);

    const extractQueue = queue.getExtractQueue();
    const inflight = await collectInflightRawEventIds(extractQueue);
    for (const row of stuck) {
      if (inflight.has(row.id)) continue;
      await queue.enqueueExtractJob({ rawEventId: row.id, teamId: row.teamId });
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
          sql`NOT (${rawEvents.sourceMetadata} ? 'embedded_at')`,
        ),
      )
      .limit(BATCH_LIMIT);

    const embedQueue = queue.getEmbedQueue();
    const inflight = await collectInflightRawEventIds(embedQueue);
    for (const row of stuck) {
      if (inflight.has(row.id)) continue;
      await queue.enqueueEmbedJob({ rawEventId: row.id, teamId: row.teamId });
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
    types: ('waiting' | 'active' | 'delayed' | 'failed')[],
    start?: number,
    end?: number,
  ) => Promise<{ data: { rawEventId?: string; factId?: string } }[]>;
}

async function collectInflightRawEventIds(q: QueueLike): Promise<Set<string>> {
  const jobs = await q.getJobs(['waiting', 'active', 'delayed', 'failed'], 0, 2000);
  return new Set(jobs.map((j) => j.data.rawEventId).filter((id): id is string => Boolean(id)));
}
