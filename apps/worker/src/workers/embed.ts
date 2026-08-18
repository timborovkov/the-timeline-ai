import { createHash } from 'node:crypto';

import { type Db, rawEvents } from '@timeline/db';
import {
  childLogger,
  chunkText,
  embedding,
  getEnv,
  integrations,
  llm,
  qdrant,
  queue,
} from '@timeline/shared';
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:embed');
const EMBEDDING_OVERLAP_TOKENS = 120;
const EMBEDDING_CHUNKS_PER_JOB = 16;
const EMBEDDING_CHUNKING_VERSION = 'exact-token-v1';

interface EmbedWorkerDeps {
  db: Db;
}

interface EmbedWorkerIO {
  getEnv?: typeof getEnv;
  embed?: typeof llm.embed;
  embedMany?: typeof llm.embedMany;
  getQdrantClient?: typeof qdrant.getQdrantClient;
  enqueueEmbedJob?: typeof queue.enqueueEmbedJob;
  takeIngestProcessingSlot?: typeof integrations.takeConnectionIngestSlot;
}

interface EmbedAttemptContext {
  attemptsMade: number;
  maxAttempts: number;
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

function embedFailureMessage(err: Error): string {
  if (
    'causeMessage' in err &&
    typeof err.causeMessage === 'string' &&
    err.causeMessage.length > 0
  ) {
    return err.causeMessage.slice(0, 500);
  }
  return err.message.slice(0, 500);
}

function embeddingChunkBudgetTokens(): number {
  return Math.max(1, Math.floor(llm.TIMELINE_MODELS.embedding.contextWindowTokens * 0.8));
}

function chunkForEmbedding(text: string) {
  const tokenBudget = embeddingChunkBudgetTokens();
  const estimatedChunks = chunkText(text, {
    targetTokens: tokenBudget,
    overlapTokens: EMBEDDING_OVERLAP_TOKENS,
  });
  return estimatedChunks
    .flatMap((chunk) => splitEmbeddingChunk(chunk.text, tokenBudget))
    .map((chunkText, index) => ({
      index,
      text: chunkText,
      tokenCount: llm.countEmbeddingTokens(chunkText),
    }));
}

function splitEmbeddingChunk(text: string, tokenBudget: number): string[] {
  if (llm.countEmbeddingTokens(text) <= tokenBudget) return [text];

  const characters = Array.from(text);
  const chunks: string[] = [];
  const overlapTokens = Math.min(EMBEDDING_OVERLAP_TOKENS, Math.max(0, tokenBudget - 1));
  let cursor = 0;
  while (cursor < characters.length) {
    let low = cursor + 1;
    let high = characters.length;
    let bestEnd = cursor;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      const candidate = characters.slice(cursor, midpoint).join('');
      if (llm.countEmbeddingTokens(candidate) <= tokenBudget) {
        bestEnd = midpoint;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }
    if (bestEnd === cursor) {
      throw new Error('Embedding token budget cannot fit one Unicode character');
    }
    chunks.push(characters.slice(cursor, bestEnd).join(''));
    if (bestEnd === characters.length) break;

    let overlapLow = cursor + 1;
    let overlapHigh = bestEnd;
    let nextCursor = bestEnd;
    while (overlapLow <= overlapHigh) {
      const midpoint = Math.floor((overlapLow + overlapHigh) / 2);
      const overlap = characters.slice(midpoint, bestEnd).join('');
      if (llm.countEmbeddingTokens(overlap) <= overlapTokens) {
        nextCursor = midpoint;
        overlapHigh = midpoint - 1;
      } else {
        overlapLow = midpoint + 1;
      }
    }
    cursor = nextCursor;
  }
  return chunks;
}

function embeddingStartChunk(data: queue.EmbedJobData): number {
  const value = 'embeddingStartChunk' in data ? data.embeddingStartChunk : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function embeddingSourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function expectedEmbeddingSourceHash(data: queue.EmbedJobData): string | null {
  const value = 'embeddingSourceHash' in data ? data.embeddingSourceHash : undefined;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function expectedEmbeddingChunkingVersion(data: queue.EmbedJobData): string | null {
  const value = 'embeddingChunkingVersion' in data ? data.embeddingChunkingVersion : undefined;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function embeddingModel(data: queue.EmbedJobData): string {
  const value = 'embeddingModel' in data ? data.embeddingModel : undefined;
  return typeof value === 'string' && value.length > 0 ? value : llm.TIMELINE_MODELS.embedding.id;
}

function continuationJob(
  data: queue.EmbedJobData,
  nextChunk: number,
  sourceHash: string,
  model: string,
): queue.EmbedJobData {
  return {
    ...data,
    embeddingStartChunk: nextChunk,
    embeddingSourceHash: sourceHash,
    embeddingChunkingVersion: EMBEDDING_CHUNKING_VERSION,
    embeddingModel: model,
  };
}

function restartJob(data: queue.EmbedJobData): queue.EmbedJobData {
  const {
    embeddingStartChunk: _start,
    embeddingSourceHash: _hash,
    embeddingChunkingVersion: _chunkingVersion,
    embeddingModel: _model,
    ...rest
  } = data;
  return rest;
}

function vectorForChunk(result: llm.EmbedManyResult, index: number): number[] {
  const vector = result.vectors[index];
  if (!vector) {
    throw new Error(
      `embedMany returned ${String(result.vectors.length)} vectors for chunk index ${String(index)}`,
    );
  }
  return vector;
}

function embeddingBatchErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const causeMessage =
      'causeMessage' in err && typeof err.causeMessage === 'string' ? err.causeMessage : '';
    return `${err.message} ${causeMessage}`.toLowerCase();
  }
  return String(err).toLowerCase();
}

function embeddingBatchErrorName(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const row = err as { name?: unknown; causeName?: unknown; cause?: unknown };
  const ownName = typeof row.name === 'string' ? row.name : '';
  const causeName = typeof row.causeName === 'string' ? row.causeName : '';
  const nestedName = row.cause ? embeddingBatchErrorName(row.cause) : '';
  return [ownName, causeName, nestedName].filter(Boolean).join(' ');
}

function isRetryableProviderOutageMessage(message: string): boolean {
  return (
    message.includes('429') ||
    message.includes('5xx') ||
    /\b5\d\d\b/.test(message) ||
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporar') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('network') ||
    message.includes('econn')
  );
}

function embeddingBatchStatusCodes(err: unknown): number[] {
  if (err instanceof AggregateError) {
    return err.errors.flatMap(embeddingBatchStatusCodes);
  }
  if (!err || typeof err !== 'object') return [];
  const row = err as {
    cause?: unknown;
    status?: unknown;
    statusCode?: unknown;
    responseStatus?: unknown;
  };
  const ownStatus = row.statusCode ?? row.status ?? row.responseStatus;
  const nested = row.cause ? embeddingBatchStatusCodes(row.cause) : [];
  return typeof ownStatus === 'number' ? [ownStatus, ...nested] : nested;
}

function hasNonBatchClientStatus(err: unknown): boolean {
  return embeddingBatchStatusCodes(err).some(
    (status) => status >= 400 && status < 500 && status !== 408 && status !== 413 && status !== 429,
  );
}

function hasRetryableProviderStatus(err: unknown): boolean {
  return embeddingBatchStatusCodes(err).some(
    (status) => status === 408 || status === 429 || status >= 500,
  );
}

function hasRetryableProviderFlag(err: unknown): boolean {
  if (err instanceof AggregateError) {
    return err.errors.some(hasRetryableProviderFlag);
  }
  if (!err || typeof err !== 'object') return false;
  const row = err as { cause?: unknown; isRetryable?: unknown };
  return row.isRetryable === true || Boolean(row.cause && hasRetryableProviderFlag(row.cause));
}

function isLastQueueAttempt(attempt: EmbedAttemptContext | undefined): boolean {
  return Boolean(
    attempt && attempt.maxAttempts > 0 && attempt.attemptsMade + 1 >= attempt.maxAttempts,
  );
}

function shouldSplitEmbeddingBatch(err: unknown, attempt?: EmbedAttemptContext): boolean {
  const message = embeddingBatchErrorMessage(err);
  const explicitBatchLimit =
    message.includes('413') ||
    message.includes('payload too large') ||
    message.includes('request body') ||
    message.includes('body size') ||
    message.includes('too many input') ||
    message.includes('too many values') ||
    message.includes('max tokens') ||
    message.includes('maximum context') ||
    message.includes('context length');
  if (explicitBatchLimit) return true;

  return (
    isLastQueueAttempt(attempt) &&
    embeddingBatchErrorName(err).includes('AI_APICallError') &&
    !hasNonBatchClientStatus(err) &&
    !hasRetryableProviderStatus(err) &&
    !hasRetryableProviderFlag(err) &&
    !isRetryableProviderOutageMessage(message)
  );
}

function validateEmbedManyResult(result: llm.EmbedManyResult, expectedCount: number): void {
  if (result.vectors.length !== expectedCount) {
    throw new Error(
      `embedMany returned ${String(result.vectors.length)} vectors for ${String(expectedCount)} chunks`,
    );
  }
  const dimensions = result.vectors[0]?.length;
  for (const [index, vector] of result.vectors.entries()) {
    if (dimensions !== undefined && vector.length !== dimensions) {
      throw new Error(
        `embedMany returned vector ${String(index)} with ${String(
          vector.length,
        )} dimensions; expected ${String(dimensions)}`,
      );
    }
    const invalidIndex = vector.findIndex((value) => !Number.isFinite(value));
    if (invalidIndex !== -1) {
      throw new Error(
        `embedMany returned non-finite value at vector ${String(index)}, dimension ${String(
          invalidIndex,
        )}`,
      );
    }
  }
}

async function embedTextBatch(
  embedMany: NonNullable<EmbedWorkerIO['embedMany']>,
  texts: string[],
  attempt?: EmbedAttemptContext,
): Promise<llm.EmbedManyResult> {
  try {
    return await embedMany({ texts });
  } catch (err) {
    if (texts.length <= 1 || !shouldSplitEmbeddingBatch(err, attempt)) throw err;
    const midpoint = Math.ceil(texts.length / 2);
    const first = await embedTextBatch(embedMany, texts.slice(0, midpoint), attempt);
    const second = await embedTextBatch(embedMany, texts.slice(midpoint), attempt);
    if (first.model !== second.model) {
      throw new Error(
        `embedMany split batches returned different models: ${first.model}, ${second.model}`,
      );
    }
    return { vectors: [...first.vectors, ...second.vectors], model: first.model };
  }
}

async function finalizeSourceEmbedding(input: {
  db: Db;
  client: qdrant.QdrantClient;
  data: queue.EmbedJobData;
  scope: qdrant.PointScope;
  sourceId: string;
  model: string;
  chunkCount: number;
}): Promise<void> {
  await input.client.deletePointsForSourceFromChunk({
    teamId: input.data.teamId,
    scope: input.scope,
    sourceId: input.sourceId,
    model: input.model,
    minChunkIndex: input.chunkCount,
  });

  // Only event-scope raw_events.source_metadata gets stamped — see Phase 5
  // rationale below. Non-event scopes don't have a single canonical row to
  // stamp; their freshness is tracked by the coverage audit script.
  if (input.scope === 'event' && 'rawEventId' in input.data) {
    const successPatch = JSON.stringify({
      embedded_at: new Date().toISOString(),
      embedding_model: input.model,
      embedding_chunks: input.chunkCount,
    });
    await input.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'embedding_failed_at' - 'embedding_error') || ${successPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, input.data.rawEventId));
  }
}

export async function processEmbedJob(
  deps: EmbedWorkerDeps,
  data: queue.EmbedJobData,
  io: EmbedWorkerIO = {},
  attempt?: EmbedAttemptContext,
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

  if ('rawEventId' in data && data.rawEventId && data.scope !== 'fact') {
    const [eventRow] = await deps.db
      .select({ source: rawEvents.source, sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, data.rawEventId))
      .limit(1);
    const integrationId = integrations.integrationIdFromSourceMetadata(eventRow?.sourceMetadata);
    if (eventRow?.source === 'integration' && integrationId) {
      const slot = await (io.takeIngestProcessingSlot ?? integrations.takeConnectionIngestSlot)({
        integrationId,
        stage: 'embed',
      });
      if (!slot.allowed) {
        return { delayed: true as const, retryAfterMs: slot.retryAfterMs };
      }
    }
  }

  // LLM calls BEFORE Qdrant writes so transient embedding failures retry
  // cleanly. Long source text is split into multiple deterministic points
  // instead of being truncated, preserving retrievable evidence.
  const embed =
    io.embed ??
    (async ({ text }) => {
      const result = await llm.embedMany({ texts: [text] }, { maxRetries: 0 });
      return { vector: vectorForChunk(result, 0), model: result.model };
    });
  const embedMany =
    io.embedMany ??
    (io.embed
      ? async ({ texts }: { texts: string[] }) => {
          const results = [];
          for (const text of texts) {
            results.push(await embed({ text }));
          }
          return {
            vectors: results.map((result) => result.vector),
            model: results[0]?.model ?? llm.TIMELINE_MODELS.embedding.id,
          };
        }
      : async ({ texts }: { texts: string[] }) => llm.embedMany({ texts }, { maxRetries: 0 }));
  const chunks = chunkForEmbedding(plan.text);
  const startChunk = embeddingStartChunk(data);
  const sourceHash = embeddingSourceHash(plan.text);
  const expectedSourceHash = expectedEmbeddingSourceHash(data);
  const expectedChunkingVersion = expectedEmbeddingChunkingVersion(data);
  if (
    startChunk > 0 &&
    (expectedSourceHash !== sourceHash || expectedChunkingVersion !== EMBEDDING_CHUNKING_VERSION)
  ) {
    const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
    await enqueueEmbedJob(restartJob(data));
    return {
      skipped: true,
      reason: 'stale_continuation',
      scope: plan.scope,
      sourceId: plan.sourceId,
    };
  }
  const chunksForJob = chunks.slice(startChunk, startChunk + EMBEDDING_CHUNKS_PER_JOB);
  const getQdrantClient = io.getQdrantClient ?? qdrant.getQdrantClient;
  const client = getQdrantClient(
    data.targetCollection ? { collection: data.targetCollection, requireExisting: true } : {},
  );
  if (chunksForJob.length === 0) {
    const model = embeddingModel(data);
    await finalizeSourceEmbedding({
      db: deps.db,
      client,
      data,
      scope: plan.scope,
      sourceId: plan.sourceId,
      model,
      chunkCount: chunks.length,
    });
    return {
      skipped: true,
      reason: 'empty_continuation_finalized',
      scope: plan.scope,
      sourceId: plan.sourceId,
      model,
    };
  }
  const result = await embedTextBatch(
    embedMany,
    chunksForJob.map((chunk) => chunk.text),
    attempt,
  );
  validateEmbedManyResult(result, chunksForJob.length);
  const embeddedChunks = chunksForJob.map((chunk, index) => ({
    ...chunk,
    vector: vectorForChunk(result, index),
    model: result.model,
  }));
  const model = result.model;
  if (!model) return { skipped: true };

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
  const pointIds = [];
  for (const chunk of embeddedChunks) {
    const pointId = qdrant.buildChunkedPointId(plan.scope, plan.sourceId, chunk.model, chunk.index);
    pointIds.push(pointId);
    await client.upsertVector(pointId, chunk.vector, { ...payload, chunk_index: chunk.index });
  }

  const nextChunk = startChunk + embeddedChunks.length;
  if (nextChunk < chunks.length) {
    const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
    await enqueueEmbedJob(continuationJob(data, nextChunk, sourceHash, model));
  } else {
    await finalizeSourceEmbedding({
      db: deps.db,
      client,
      data,
      scope: plan.scope,
      sourceId: plan.sourceId,
      model,
      chunkCount: chunks.length,
    });
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
    async (job: Job<queue.EmbedJobData>, token?: string) => {
      const result = await processEmbedJob(
        deps,
        job.data,
        {},
        {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? 1,
        },
      );
      if (integrations.isDelayedIngestResult(result)) {
        await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
        throw new DelayedError();
      }
      return result;
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
    if (err instanceof DelayedError) return;
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
      embedding_error: embedFailureMessage(err),
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
  attempt?: EmbedAttemptContext,
) {
  return processEmbedJob(deps, data, io, attempt);
}

export const embedWorkerInternals = {
  embedFailureTags,
  embedFailureMessage,
  splitEmbeddingChunk,
  embeddingOverlapTokens: EMBEDDING_OVERLAP_TOKENS,
  embeddingChunksPerJob: EMBEDDING_CHUNKS_PER_JOB,
  embeddingChunkingVersion: EMBEDDING_CHUNKING_VERSION,
};
