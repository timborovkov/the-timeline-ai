import { type Db, entities, facts as factsTable, factEntities, rawEvents } from '@timeline/db';
import {
  childLogger,
  embedding,
  extract,
  getEnv,
  integrations,
  llm,
  queue,
} from '@timeline/shared';
import { reconcileLinkArtifactsForRawEvent } from '@timeline/shared/conversational/link-artifacts';
import {
  currentExtractionModelVersions,
  makeExtractionModelVersion,
} from '@timeline/shared/extraction-model-version';
import { fireAndForgetObjectSummaryRefresh } from '@timeline/shared/objects';
import { withTeam } from '@timeline/shared/team-scope';
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { captureWorkerException, captureWorkerJobFailure } from '#src/monitoring.js';

const log = childLogger('worker:extract');
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

interface ExtractWorkerDeps {
  db: Db;
}

const RECENT_CONTEXT_LIMIT = 5;

export interface ExtractProcessorIO {
  getEnv?: typeof getEnv;
  chatStructured?: typeof llm.chatStructured;
  modelId?: string;
  enqueueSuggestionJob?: typeof queue.enqueueSuggestionJob;
  enqueueEmbedJob?: typeof queue.enqueueEmbedJob;
  enqueueObjectSummaryRefresh?: ((objectId: string) => Promise<void>) | undefined;
  takeIngestProcessingSlot?: typeof integrations.takeConnectionIngestSlot;
}

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
  source: string;
  visibility: 'private' | 'team' | 'specific_users';
  sourceMetadata: unknown;
}

function extractFailureTags(job: Pick<Job<queue.ExtractJobData>, 'data'> | undefined) {
  const data = job?.data;
  if (!data || typeof data !== 'object') return {};
  return {
    rawEventId: typeof data.rawEventId === 'string' ? data.rawEventId : undefined,
    teamId: typeof data.teamId === 'string' ? data.teamId : undefined,
  };
}

export async function processExtractJobForTests(
  deps: ExtractWorkerDeps,
  jobData: queue.ExtractJobData,
  io: ExtractProcessorIO = {},
): Promise<
  | { rawEventId: string; factsInserted: number; modelVersion: string }
  | { rawEventId: string; skipped: true; reason: string }
  | { rawEventId: string; skipped: true; modelVersion: string }
  | { rawEventId: string; delayed: true; retryAfterMs: number }
> {
  const { rawEventId, teamId } = jobData;
  const env = (io.getEnv ?? getEnv)();
  const modelId = io.modelId ?? llm.TIMELINE_MODELS.extraction.id;
  const modelVersion = makeExtractionModelVersion(modelId);
  const currentModelVersions =
    io.modelId && io.modelId !== llm.TIMELINE_MODELS.extraction.id
      ? [modelVersion]
      : currentExtractionModelVersions();
  const lockKey = sql`hashtextextended(${rawEventId}, 0)`;

  const rows = (await deps.db
    .select({
      id: rawEvents.id,
      teamId: rawEvents.teamId,
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
      source: rawEvents.source,
      visibility: rawEvents.visibility,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(eq(rawEvents.id, rawEventId))
    .limit(1)) as RawEventRow[];
  const row = rows[0];
  if (!row) throw new UnrecoverableError(`raw event ${rawEventId} not found`);
  if (row.teamId !== teamId) {
    throw new UnrecoverableError(
      `raw event ${rawEventId} team mismatch (job=${teamId}, row=${row.teamId})`,
    );
  }
  const text = embedding.renderRawEventForAi({
    source: row.source,
    contentText: row.contentText,
    sourceMetadata: row.sourceMetadata,
  });
  if (!text) {
    throw new UnrecoverableError(`raw event ${rawEventId} has no content_text; nothing to extract`);
  }
  await reconcileLinkArtifactsForRawEvent(deps.db, {
    teamId,
    rawEventId,
    text,
    occurredAt: row.occurredAt,
  }).catch((err: unknown) => {
    log.error({ err, rawEventId }, 'link artifact reconciliation failed during extract');
    captureWorkerException(err, {
      component: 'worker_link_artifacts',
      queueName: queue.QUEUE_NAMES.extract,
      operation: 'reconcile_link_artifacts_after_extract_load',
    });
  });

  if (row.visibility !== 'team') {
    const skipPatch = JSON.stringify({
      extraction_skipped_at: new Date().toISOString(),
      extraction_skipped_reason: `visibility=${row.visibility}`,
      extraction_model_version: modelVersion,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'extraction_failed_at' - 'extraction_error') || ${skipPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
    return { rawEventId, skipped: true, reason: `visibility=${row.visibility}` };
  }

  const provider = integrations.providerFromSourceMetadata(row.sourceMetadata);
  if (
    row.source === 'integration' &&
    provider &&
    integrations.integrationSkipsLlmIngest(provider)
  ) {
    const skipPatch = JSON.stringify({
      extraction_skipped_at: new Date().toISOString(),
      extraction_skipped_reason: 'integration_structured_source',
      extraction_model_version: modelVersion,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'extraction_failed_at' - 'extraction_error') || ${skipPatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
    return { rawEventId, skipped: true, reason: 'integration_structured_source' };
  }

  const meta =
    row.sourceMetadata && typeof row.sourceMetadata === 'object'
      ? (row.sourceMetadata as Record<string, unknown>)
      : {};
  if (
    typeof meta.extraction_model_version === 'string' &&
    currentModelVersions.includes(meta.extraction_model_version)
  ) {
    return { rawEventId, skipped: true, modelVersion: meta.extraction_model_version };
  }

  if (!env.OPENROUTER_API_KEY) {
    throw new UnrecoverableError(
      `extract: OPENROUTER_API_KEY not configured; cannot run extraction`,
    );
  }

  const integrationId = integrations.integrationIdFromSourceMetadata(row.sourceMetadata);
  if (row.source === 'integration' && integrationId) {
    const slot = await (io.takeIngestProcessingSlot ?? integrations.takeConnectionIngestSlot)({
      integrationId,
      stage: 'extract',
    });
    if (!slot.allowed) {
      return { rawEventId, delayed: true, retryAfterMs: slot.retryAfterMs };
    }
  }

  const recentRows = (await deps.db
    .select({
      contentText: rawEvents.contentText,
      occurredAt: rawEvents.occurredAt,
      source: rawEvents.source,
      sourceMetadata: rawEvents.sourceMetadata,
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.teamId, teamId),
        lt(rawEvents.occurredAt, row.occurredAt),
        eq(rawEvents.visibility, 'team'),
      ),
    )
    .orderBy(desc(rawEvents.occurredAt))
    .limit(RECENT_CONTEXT_LIMIT)) as {
    contentText: string | null;
    occurredAt: Date;
    source: string;
    sourceMetadata: unknown;
  }[];

  const prompt = llm.truncateTextToTokenBudget(
    extract.buildExtractionPrompt({
      current: { occurredAt: row.occurredAt.toISOString(), text },
      recent: recentRows
        .map((r) => ({
          occurredAt: r.occurredAt.toISOString(),
          text: embedding.renderRawEventForAi({
            source: r.source,
            contentText: r.contentText,
            sourceMetadata: r.sourceMetadata,
          }),
        }))
        .filter((r): r is { occurredAt: string; text: string } => Boolean(r.text)),
    }),
    llm.inputTokenBudgetFor(llm.TIMELINE_MODELS.extraction),
  );

  const result = await (io.chatStructured ?? llm.chatStructured)({
    schema: extract.extractionResultSchema,
    prompt,
    system: extract.EXTRACTION_SYSTEM_PROMPT,
    model: modelId,
  });
  const resultModelVersion = makeExtractionModelVersion(result.model);
  const extractionResult = {
    facts: extract
      .normalizeExtractionResult(result.object)
      .facts.filter((fact) => !extract.isNoisyExtractedFact(fact))
      .map((fact) => ({
        ...fact,
        mentions: fact.mentions.filter((mention) => !extract.isLowSignalEntityMention(mention)),
      })),
  };

  const resolvedFacts: {
    statement: string;
    confidence: number;
    entityIds: (string | null)[];
    mentions: (typeof extractionResult.facts)[number]['mentions'];
  }[] = [];
  for (const fact of extractionResult.facts) {
    const entityIds = await extract.resolveMentions(
      deps.db,
      teamId,
      fact.mentions,
      fact.statement,
      {},
      { createIfMissing: false, updateAliases: false },
    );
    resolvedFacts.push({
      statement: fact.statement,
      confidence: fact.confidence,
      entityIds,
      mentions: fact.mentions,
    });
  }

  let factsInserted = 0;
  const insertedFactIds: string[] = [];
  const summaryEntityIds = new Set<string>();
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const recheck = (await tx
      .select({ sourceMetadata: rawEvents.sourceMetadata })
      .from(rawEvents)
      .where(eq(rawEvents.id, rawEventId))
      .limit(1)) as { sourceMetadata: unknown }[];
    const recheckMeta =
      recheck[0]?.sourceMetadata && typeof recheck[0].sourceMetadata === 'object'
        ? (recheck[0].sourceMetadata as Record<string, unknown>)
        : {};
    if (
      (typeof recheckMeta.extraction_model_version === 'string' &&
        currentModelVersions.includes(recheckMeta.extraction_model_version)) ||
      recheckMeta.extraction_model_version === resultModelVersion
    ) {
      return;
    }
    const referencedEntityIds = Array.from(
      new Set(
        resolvedFacts.flatMap((fact) =>
          fact.entityIds.filter((entityId): entityId is string => Boolean(entityId)),
        ),
      ),
    );
    const activeReferencedEntities =
      referencedEntityIds.length > 0
        ? await tx
            .select({
              id: entities.id,
              archivedAt: entities.archivedAt,
              metadata: entities.metadata,
            })
            .from(entities)
            .where(
              and(
                eq(entities.teamId, teamId),
                inArray(entities.id, referencedEntityIds),
                isNull(entities.mergedIntoId),
              ),
            )
            .orderBy(
              sql`CASE WHEN ${entities.type} = 'project' THEN 0 WHEN ${entities.type} = 'task' THEN 1 ELSE 2 END`,
              asc(entities.id),
            )
            .for('update')
        : [];
    const activeReferencedEntityIds = new Set(
      activeReferencedEntities
        .filter((entity) => {
          const metadata =
            entity.metadata && typeof entity.metadata === 'object'
              ? (entity.metadata as Record<string, unknown>)
              : {};
          return !(
            entity.archivedAt !== null &&
            typeof metadata.agent_suggestion_project_for_item_id === 'string'
          );
        })
        .map((entity) => entity.id),
    );
    for (const fact of resolvedFacts) {
      const insertedFacts = await tx
        .insert(factsTable)
        .values({
          teamId,
          rawEventId,
          statement: fact.statement,
          confidence: fact.confidence,
          modelVersion: resultModelVersion,
        })
        .onConflictDoNothing()
        .returning({ id: factsTable.id });
      const factRow = insertedFacts[0];
      if (!factRow) continue;
      factsInserted += 1;
      insertedFactIds.push(factRow.id);
      const seen = new Set<string>();
      for (let i = 0; i < fact.mentions.length; i += 1) {
        const m = fact.mentions[i];
        const entityId = fact.entityIds[i];
        if (!m || !entityId || !activeReferencedEntityIds.has(entityId)) continue;
        const key = `${entityId}:${m.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx
          .insert(factEntities)
          .values({ factId: factRow.id, entityId, role: m.role })
          .onConflictDoNothing();
        summaryEntityIds.add(entityId);
      }
    }

    const patch = JSON.stringify({
      extracted_at: new Date().toISOString(),
      extraction_model_version: resultModelVersion,
    });
    await tx
      .update(rawEvents)
      .set({
        sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'extraction_failed_at' - 'extraction_error') || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId));
  });

  try {
    await (io.enqueueSuggestionJob ?? queue.enqueueSuggestionJob)({ rawEventId, teamId });
  } catch (err) {
    log.error({ err, rawEventId }, 'failed to enqueue suggestion job');
    captureWorkerException(err, {
      component: 'worker_handoff',
      queueName: queue.QUEUE_NAMES.suggestions,
      operation: 'enqueue_suggestion_after_extract',
    });
  }

  const objectSummaryScope = withTeam(deps.db, teamId, ZERO_UUID, { skipMembershipCheck: true });
  const enqueueObjectSummaryRefresh =
    io.enqueueObjectSummaryRefresh ??
    ((objectId: string) =>
      fireAndForgetObjectSummaryRefresh(deps.db, objectSummaryScope, objectId, {
        rawEventId,
        objectId,
        trigger: 'extract_fact_link',
      }));
  for (const objectId of summaryEntityIds) {
    try {
      await enqueueObjectSummaryRefresh(objectId);
    } catch (err) {
      log.error({ err, rawEventId, objectId }, 'object summary enqueue failed after extract');
      captureWorkerException(err, {
        component: 'worker_handoff',
        queueName: queue.QUEUE_NAMES.objectSummary,
        operation: 'enqueue_object_summary_after_extract',
        objectId,
      });
    }
  }

  const enqueueEmbedJob = io.enqueueEmbedJob ?? queue.enqueueEmbedJob;
  const enqueueFailures: { factId: string | null; err: unknown }[] = [];
  try {
    await enqueueEmbedJob({ rawEventId, teamId });
  } catch (err) {
    enqueueFailures.push({ factId: null, err });
  }
  for (const factId of insertedFactIds) {
    try {
      await enqueueEmbedJob({ rawEventId, teamId, factId });
    } catch (err) {
      enqueueFailures.push({ factId, err });
    }
  }
  if (enqueueFailures.length > 0) {
    for (const f of enqueueFailures) {
      log.error({ factId: f.factId ?? 'event', err: f.err }, 'embed enqueue failed');
      captureWorkerException(f.err, {
        component: 'worker_handoff',
        queueName: queue.QUEUE_NAMES.embed,
        operation: 'enqueue_embed_after_extract',
        target: f.factId ? 'fact' : 'event',
      });
    }
    const firstErr = enqueueFailures[0]?.err;
    const failurePatch = JSON.stringify({
      embedding_failed_at: new Date().toISOString(),
      embedding_error: `enqueue failed (${String(enqueueFailures.length)} job(s)): ${
        firstErr instanceof Error ? firstErr.message.slice(0, 440) : 'unknown'
      }`,
    });
    await deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${failurePatch}::jsonb`,
      })
      .where(eq(rawEvents.id, rawEventId))
      .catch((markErr: unknown) => {
        log.error({ err: markErr }, 'failed to mark embed failure');
        captureWorkerException(markErr, {
          component: 'worker_failure_marker',
          operation: 'mark_embed_enqueue_failure',
        });
      });
  }

  return { rawEventId, factsInserted, modelVersion: resultModelVersion };
}

/**
 * Build the `model_version` tag persisted with each fact. Combines the model
 * id with a short code-rev hash so prompt or schema changes can be detected
 * by the re-extraction script even when the model id is unchanged.
 */
/**
 * Extract worker: reads a raw event's text, calls the LLM to produce
 * structured facts + entity mentions, and writes them in a single
 * transaction. Idempotent: a second run for the same (rawEventId, modelVersion)
 * is a no-op because the worker checks for existing facts first and the
 * facts unique index also guards against double-insert under concurrency.
 *
 * Failure modes:
 *   - `OPENROUTER_API_KEY` unset → `llm.chat` throws, BullMQ retries.
 *   - Event row missing (deleted between enqueue and process) → UnrecoverableError.
 *   - `content_text` null (audio not yet transcribed) → UnrecoverableError; we
 *     never enqueue extract before transcript exists, so this is a safety net.
 *   - LLM returns malformed JSON beyond zod repair → ai-sdk throws, BullMQ retries.
 */
/** BullMQ default lock is 30s; LLM extract can outlive that across deploy/Redis blips. */
const EXTRACT_LOCK_DURATION_MS = 5 * 60_000;

function isBullMqStallFailure(err: unknown): boolean {
  return err instanceof Error && /job stalled more than allowable limit/i.test(err.message);
}

export function startExtractWorker(deps: ExtractWorkerDeps): Worker<queue.ExtractJobData> {
  const worker = new Worker<queue.ExtractJobData>(
    queue.QUEUE_NAMES.extract,
    async (job: Job<queue.ExtractJobData>, token?: string) => {
      const result = await processExtractJobForTests(deps, job.data);
      if ('delayed' in result && result.delayed) {
        await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
        throw new DelayedError();
      }
      return result;
    },
    {
      connection: queue.getRedisConnection(),
      // One in-flight extraction per process. Extraction is heavier than
      // transcription per job and benefits less from parallelism.
      concurrency: 1,
      lockDuration: EXTRACT_LOCK_DURATION_MS,
      // Allow one stall recovery before BullMQ marks the job unrecoverable.
      maxStalledCount: 2,
    },
  );

  worker.on('failed', (job, err) => {
    if (err instanceof DelayedError) return;
    log.error({ jobId: job?.id, err }, 'job failed');
    captureWorkerJobFailure(err, job, extractFailureTags(job));
    if (!job) return;
    // Stall deaths are infra/deploy lock-loss, not bad event content. Do not
    // stamp extraction_failed_* so job-recovery / re-enqueue can retry.
    if (isBullMqStallFailure(err)) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const unrecoverable = err instanceof UnrecoverableError;
    if (!unrecoverable && job.attemptsMade < maxAttempts) return;
    const patch = JSON.stringify({
      extraction_failed_at: new Date().toISOString(),
      extraction_error: err.message.slice(0, 500),
    });
    void deps.db
      .update(rawEvents)
      .set({
        sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
      })
      .where(eq(rawEvents.id, job.data.rawEventId))
      .catch((updateErr: unknown) => {
        log.error({ err: updateErr }, 'failed to mark row failure');
        captureWorkerException(updateErr, {
          component: 'worker_failure_marker',
          operation: 'mark_extraction_failure',
        });
      });
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  return worker;
}

export const extractWorkerInternals = { extractFailureTags, isBullMqStallFailure };
