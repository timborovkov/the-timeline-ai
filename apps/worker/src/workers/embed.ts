import { type Db, rawEvents } from '@timeline/db';
import { childLogger, embedding, getEnv, llm, qdrant, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

const log = childLogger('worker:embed');

interface EmbedWorkerDeps {
  db: Db;
}

interface EmbedWorkerIO {
  getEnv?: typeof getEnv;
  embed?: typeof llm.embed;
  getQdrantClient?: typeof qdrant.getQdrantClient;
}

async function processEmbedJob(
  deps: EmbedWorkerDeps,
  data: queue.EmbedJobData,
  io: EmbedWorkerIO = {},
) {
  const env = (io.getEnv ?? getEnv)();
  if (!env.OPENROUTER_API_KEY) {
    throw new UnrecoverableError('embed: OPENROUTER_API_KEY not configured');
  }
  if (!env.QDRANT_URL) {
    throw new UnrecoverableError('embed: QDRANT_URL not configured');
  }

  const scope = embedding.resolveEmbeddingScope(data);
  const plan = await embedding.buildEmbeddingPlan(deps.db, data, scope);
  if (!plan) {
    // No-op (e.g. visibility-skipped raw event already stamped,
    // object_change with empty summary, or doc-chunk whose parent
    // document was soft-deleted between enqueue and process).
    // Success path with no Qdrant write.
    return { skipped: true };
  }

  // LLM call BEFORE Qdrant write so a transient embedding failure
  // retries cleanly. No DB transaction is open during the network call.
  const embed = io.embed ?? llm.embed;
  const { vector, model } = await embed({ text: plan.text });
  const getQdrantClient = io.getQdrantClient ?? qdrant.getQdrantClient;
  const client = getQdrantClient(
    data.targetCollection ? { collection: data.targetCollection, requireExisting: true } : {},
  );
  const pointId = qdrant.buildPointId(plan.scope, plan.sourceId, model);
  const basePayload = embedding.blankEmbeddingPayload({
    teamId: data.teamId,
    occurredAt: plan.occurredAt,
    authorUserId: plan.authorUserId,
    model,
    sourceKind: plan.sourceKind,
  });
  const payload: qdrant.QdrantPayload = {
    ...basePayload,
    ...plan.payloadOverrides,
    embedding_model: model,
  };
  await client.upsertVector(pointId, vector, payload);

  // Only event-scope raw_events.source_metadata gets stamped — see Phase 5
  // rationale below. Non-event scopes don't have a single canonical row to
  // stamp; their freshness is tracked by the coverage audit script.
  if (plan.scope === 'event' && 'rawEventId' in data) {
    const successPatch = JSON.stringify({
      embedded_at: new Date().toISOString(),
      embedding_model: model,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${successPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, data.rawEventId));
  }

  return { scope: plan.scope, sourceId: plan.sourceId, model, pointId };
}

/**
 * Embed worker: writes one Qdrant point per source row using the pinned
 * embedding model. Phase 5 covers {raw_event, fact}; Phase 8 follow-ups
 * add {object, object_note, object_change, entity}.
 *
 * Idempotency comes from deterministic Qdrant point ids derived from
 * (scope, sourceId, embedding_model). A duplicate enqueue upserts the same
 * point and costs at most one embedding call.
 *
 * Failure modes:
 *   - `OPENROUTER_API_KEY` or `QDRANT_URL` unset → UnrecoverableError.
 *   - Source row missing / wrong team → UnrecoverableError.
 *   - Non-team visibility raw event → stamp skip reason, return success.
 *   - Empty text (e.g. object_change with no narrative) → success no-op.
 *   - LLM or Qdrant transient errors → BullMQ retries.
 */
export function startEmbedWorker(deps: EmbedWorkerDeps): Worker<queue.EmbedJobData> {
  const worker = new Worker<queue.EmbedJobData>(
    queue.QUEUE_NAMES.embed,
    async (job: Job<queue.EmbedJobData>) => {
      return processEmbedJob(deps, job.data);
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
    // Symmetric with Phase 5: only raw-event-scope failures land on
    // raw_events.source_metadata (UI surfaces it). Fact-scope failures and
    // the new non-event scopes are operational — visible in worker logs and
    // recoverable via the reembed script + coverage audit.
    const scope = embedding.resolveEmbeddingScope(job.data);
    if (scope !== 'event') return;
    if (!('rawEventId' in job.data) || !job.data.rawEventId) return;
    const patch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: err.message.slice(0, 500),
    });
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

export async function buildPlanForTests(
  db: Db,
  data: queue.EmbedJobData,
  scope: qdrant.PointScope,
): Promise<embedding.EmbeddingPlan | null> {
  return embedding.buildEmbeddingPlan(db, data, scope);
}

export async function processEmbedJobForTests(
  deps: EmbedWorkerDeps,
  data: queue.EmbedJobData,
  io: EmbedWorkerIO = {},
) {
  return processEmbedJob(deps, data, io);
}
