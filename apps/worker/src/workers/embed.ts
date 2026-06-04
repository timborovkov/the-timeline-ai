import { type Db, rawEvents } from '@timeline/db';
import { childLogger, chunkText, embedding, getEnv, llm, qdrant, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:embed');
const EMBEDDING_OVERLAP_TOKENS = 120;
const EMBEDDING_CHUNKS_PER_JOB = 16;

interface EmbedWorkerDeps {
  db: Db;
}

interface EmbedWorkerIO {
  getEnv?: typeof getEnv;
  embed?: typeof llm.embed;
  getQdrantClient?: typeof qdrant.getQdrantClient;
  enqueueEmbedJob?: typeof queue.enqueueEmbedJob;
}

function embedFailureTags(job: Pick<Job<queue.EmbedJobData>, 'data'> | undefined) {
  const data = job?.data;
  if (!data || typeof data !== 'object') return {};
  const rawEventId =
    'rawEventId' in data && typeof data.rawEventId === 'string' ? data.rawEventId : undefined;
  const factId = 'factId' in data && typeof data.factId === 'string' ? data.factId : undefined;
  const teamId = 'teamId' in data && typeof data.teamId === 'string' ? data.teamId : undefined;
  try {
    return { scope: embedding.resolveEmbeddingScope(data), rawEventId, factId, teamId };
  } catch {
    return { rawEventId, factId, teamId };
  }
}

function embeddingChunkBudgetTokens(): number {
  return Math.max(1, Math.floor(llm.TIMELINE_MODELS.embedding.contextWindowTokens * 0.8));
}

function chunkForEmbedding(text: string) {
  return chunkText(text, {
    targetTokens: embeddingChunkBudgetTokens(),
    overlapTokens: EMBEDDING_OVERLAP_TOKENS,
  });
}

function embeddingStartChunk(data: queue.EmbedJobData): number {
  const value = 'embeddingStartChunk' in data ? data.embeddingStartChunk : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function continuationJob(data: queue.EmbedJobData, nextChunk: number): queue.EmbedJobData {
  return { ...data, embeddingStartChunk: nextChunk };
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

  // LLM calls BEFORE Qdrant writes so transient embedding failures retry
  // cleanly. Long source text is split into multiple deterministic points
  // instead of being truncated, preserving retrievable evidence.
  const embed = io.embed ?? llm.embed;
  const chunks = chunkForEmbedding(plan.text);
  const startChunk = embeddingStartChunk(data);
  const chunksForJob = chunks.slice(startChunk, startChunk + EMBEDDING_CHUNKS_PER_JOB);
  if (chunksForJob.length === 0) return { skipped: true };
  const embeddedChunks = [];
  for (const chunk of chunksForJob) {
    const result = await embed({ text: chunk.text });
    embeddedChunks.push({ ...chunk, vector: result.vector, model: result.model });
  }
  const model = embeddedChunks[0]?.model;
  if (!model) return { skipped: true };

  const getQdrantClient = io.getQdrantClient ?? qdrant.getQdrantClient;
  const client = getQdrantClient(
    data.targetCollection ? { collection: data.targetCollection, requireExisting: true } : {},
  );
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
    source_scope: plan.scope,
    source_id: plan.sourceId,
    chunk_index: 0,
  };
  if (startChunk === 0) {
    await client.deletePointsForSource({
      teamId: data.teamId,
      scope: plan.scope,
      sourceId: plan.sourceId,
      model,
    });
  }
  const pointIds = [];
  for (const chunk of embeddedChunks) {
    const pointId = qdrant.buildChunkedPointId(plan.scope, plan.sourceId, chunk.model, chunk.index);
    pointIds.push(pointId);
    await client.upsertVector(pointId, chunk.vector, { ...payload, chunk_index: chunk.index });
  }

  const nextChunk = startChunk + embeddedChunks.length;
  if (nextChunk < chunks.length) {
    const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
    await enqueueEmbedJob(continuationJob(data, nextChunk));
  }

  // Only event-scope raw_events.source_metadata gets stamped — see Phase 5
  // rationale below. Non-event scopes don't have a single canonical row to
  // stamp; their freshness is tracked by the coverage audit script.
  if (plan.scope === 'event' && 'rawEventId' in data && nextChunk >= chunks.length) {
    const successPatch = JSON.stringify({
      embedded_at: new Date().toISOString(),
      embedding_model: model,
      embedding_chunks: chunks.length,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${successPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, data.rawEventId));
  }

  return { scope: plan.scope, sourceId: plan.sourceId, model, pointId: pointIds[0], pointIds };
}

/**
 * Embed worker: writes one or more Qdrant chunk points per source row using the
 * pinned embedding model. Phase 5 covers {raw_event, fact}; Phase 8 follow-ups
 * add {object, object_note, object_change, entity}.
 *
 * Idempotency comes from deterministic Qdrant point ids derived from
 * (scope, sourceId, embedding_model, chunk_index). A duplicate enqueue upserts
 * the same point(s) and costs at most the same embedding calls.
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
    captureWorkerJobFailure(err, job, embedFailureTags(job));
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
        captureWorkerException(updateErr, {
          component: 'worker_failure_marker',
          operation: 'mark_embedding_failure',
        });
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

export const embedWorkerInternals = { embedFailureTags };
