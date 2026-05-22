import { type Db, facts as factsTable, factEntities, rawEvents } from '@timeline/db';
import { childLogger, getEnv, llm, qdrant, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

const log = childLogger('worker:embed');

interface EmbedWorkerDeps {
  db: Db;
}

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
  authorUserId: string | null;
  source: 'web' | 'telegram' | 'email' | 'system';
  visibility: 'private' | 'team' | 'specific_users';
  visibilityUserIds: string[] | null;
  sourceMetadata: unknown;
}

interface FactRow {
  id: string;
  teamId: string;
  rawEventId: string;
  statement: string;
}

/**
 * Embed worker: writes one Qdrant point per (raw_event | fact) using the
 * pinned embedding model. Mirrors the extract worker's shape — privacy gate,
 * idempotency, failure-marker patterns are intentionally near-identical.
 *
 * Idempotency comes from deterministic Qdrant point ids derived from
 * (scope, sourceId, embedding_model). A duplicate enqueue upserts the same
 * point and costs at most one embedding call.
 *
 * Failure modes:
 *   - `OPENROUTER_API_KEY` or `QDRANT_URL` unset → UnrecoverableError (don't
 *     burn retries on permanent misconfiguration).
 *   - Raw event missing / wrong team → UnrecoverableError.
 *   - Fact missing → UnrecoverableError.
 *   - Non-team visibility raw event → stamp skip reason, return success.
 *   - LLM or Qdrant transient errors → BullMQ retries.
 */
export function startEmbedWorker(deps: EmbedWorkerDeps): Worker<queue.EmbedJobData> {
  const worker = new Worker<queue.EmbedJobData>(
    queue.QUEUE_NAMES.embed,
    async (job: Job<queue.EmbedJobData>) => {
      const { rawEventId, teamId, factId, targetCollection } = job.data;
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY) {
        throw new UnrecoverableError('embed: OPENROUTER_API_KEY not configured');
      }
      if (!env.QDRANT_URL) {
        throw new UnrecoverableError('embed: QDRANT_URL not configured');
      }

      const rows = (await deps.db
        .select({
          id: rawEvents.id,
          teamId: rawEvents.teamId,
          contentText: rawEvents.contentText,
          occurredAt: rawEvents.occurredAt,
          authorUserId: rawEvents.authorUserId,
          source: rawEvents.source,
          visibility: rawEvents.visibility,
          visibilityUserIds: rawEvents.visibilityUserIds,
          sourceMetadata: rawEvents.sourceMetadata,
        })
        .from(rawEvents)
        .where(eq(rawEvents.id, rawEventId))
        .limit(1)) as RawEventRow[];
      const row = rows[0];
      if (!row) {
        throw new UnrecoverableError(`raw event ${rawEventId} not found`);
      }
      if (row.teamId !== teamId) {
        throw new UnrecoverableError(
          `raw event ${rawEventId} team mismatch (job=${teamId}, row=${row.teamId})`,
        );
      }

      // Hard privacy gate — same shape and rationale as extract.ts. Non-team
      // events never have their text or derived statements sent to OpenRouter,
      // and they never land in Qdrant (where a future visibility relaxation
      // could otherwise leak them into team-mate searches). Stamp the skip
      // reason so the reembed script does not re-enqueue this row on each run.
      if (row.visibility !== 'team') {
        const skipPatch = JSON.stringify({
          embedding_skipped_at: new Date().toISOString(),
          embedding_skipped_reason: `visibility=${row.visibility}`,
          embedding_model: env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
        });
        await deps.db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${skipPatch}::jsonb`,
          })
          .where(eq(rawEvents.id, rawEventId));
        return { rawEventId, skipped: true, reason: `visibility=${row.visibility}` };
      }

      // Resolve the text to embed and the entity_ids that go on the payload.
      let text: string;
      let scope: qdrant.PointScope;
      let sourceId: string;
      let entityIds: string[] = [];
      let factIdForPayload: string | null = null;

      if (factId) {
        const factRows = (await deps.db
          .select({
            id: factsTable.id,
            teamId: factsTable.teamId,
            rawEventId: factsTable.rawEventId,
            statement: factsTable.statement,
          })
          .from(factsTable)
          .where(eq(factsTable.id, factId))
          .limit(1)) as FactRow[];
        const fact = factRows[0];
        if (!fact) {
          throw new UnrecoverableError(`fact ${factId} not found`);
        }
        if (fact.teamId !== teamId || fact.rawEventId !== rawEventId) {
          throw new UnrecoverableError(
            `fact ${factId} does not belong to (team=${teamId}, rawEvent=${rawEventId})`,
          );
        }
        text = fact.statement.trim();
        scope = 'fact';
        sourceId = fact.id;
        factIdForPayload = fact.id;
        const links = await deps.db
          .select({ entityId: factEntities.entityId })
          .from(factEntities)
          .where(eq(factEntities.factId, fact.id));
        entityIds = links.map((l) => l.entityId);
      } else {
        const eventText = row.contentText?.trim();
        if (!eventText) {
          throw new UnrecoverableError(
            `raw event ${rawEventId} has no content_text; nothing to embed`,
          );
        }
        text = eventText;
        scope = 'event';
        sourceId = row.id;
      }

      // LLM call BEFORE Qdrant write so a transient embedding failure
      // retries cleanly. No DB transaction is open during the network call.
      const { vector, model } = await llm.embed({ text });
      // getQdrantClient caches by (collection, requireExisting), so a
      // reembed of thousands of rows pays one collection-existence check
      // per process — not one per job. When targetCollection is set
      // (re-embed migration path), requireExisting forces the wrapper to
      // error rather than silently auto-create the new collection at the
      // OLD EMBEDDING_DIMENSIONS.
      const client = qdrant.getQdrantClient(
        targetCollection ? { collection: targetCollection, requireExisting: true } : {},
      );
      const pointId = qdrant.buildPointId(scope, sourceId, model);
      const payload: qdrant.QdrantPayload = {
        team_id: teamId,
        event_id: row.id,
        fact_id: factIdForPayload,
        entity_ids: entityIds,
        occurred_at: row.occurredAt.toISOString(),
        author_user_id: row.authorUserId,
        source: row.source,
        visibility: row.visibility,
        // Persist visibility_user_ids on every point so the wrapper's
        // specific_users filter branch (which keys on this field) is
        // structurally consistent with the payload. Today this is null
        // because the privacy gate above blocks anything other than
        // visibility='team' from reaching this code path, but writing it
        // unconditionally means a future relaxation of the gate cannot
        // silently produce points that fail the filter.
        visibility_user_ids: row.visibilityUserIds,
        embedding_model: model,
      };
      await client.upsertVector(pointId, vector, payload);

      // Only EVENT-scope jobs touch raw_events.source_metadata. A single
      // raw event can spawn many embed jobs (one event-level + N fact-level
      // for N facts), and they all share the same row. If fact-level jobs
      // stamped `embedded_at`, a later EVENT-level failure could be silently
      // masked by the failed-handler's `NOT ? 'embedded_at'` guard — the
      // event body would be missing from Qdrant with no durable signal.
      // The timeline UI only cares about per-event status; per-fact embed
      // status is operational (worker logs + Qdrant point presence). A
      // fact-embed failure is a backfill candidate via the reembed script.
      if (scope === 'event') {
        const successPatch = JSON.stringify({
          embedded_at: new Date().toISOString(),
          embedding_model: model,
        });
        await deps.db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${successPatch}::jsonb`,
          })
          .where(eq(rawEvents.id, rawEventId));
      }

      return { rawEventId, factId: factId ?? null, model, pointId };
    },
    {
      connection: queue.getRedisConnection(),
      // Embedding is light on CPU per job but bound by OpenRouter latency.
      // Modest parallelism keeps throughput reasonable without hammering the
      // provider. Tune once we have real numbers.
      concurrency: 4,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const unrecoverable = err instanceof UnrecoverableError;
    if (!unrecoverable && job.attemptsMade < maxAttempts) return;
    // Symmetric with the success path: fact-scope failures are operational
    // (visible in worker logs, recoverable via reembed). Only event-scope
    // failures land on raw_events.source_metadata, because that's what the
    // timeline UI surfaces. Without this scope check, a permanently-failing
    // fact embed would stamp `embedding_failed_at` on a row whose event-body
    // embed is healthy — the UI would show "embedding unavailable" for a
    // searchable event.
    if (job.data.factId) return;
    const patch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: err.message.slice(0, 500),
    });
    // Guard against a stale failed-event arriving AFTER a later successful
    // retry has stamped embedded_at: if the row is already marked embedded,
    // do not re-stamp it as failed. BullMQ's failed/completed event ordering
    // is not strictly causal across attempts, and we don't want a late
    // failure to overwrite a fresh success.
    void deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(
        sql`${rawEvents.id} = ${job.data.rawEventId} AND NOT (COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) ? 'embedded_at')`,
      )
      .catch((updateErr: unknown) => {
        log.error({ err: updateErr }, 'failed to mark row failure');
      });
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  return worker;
}
