import { type Db, facts as factsTable, factEntities, rawEvents } from '@timeline/db';
import { childLogger, embedding, extract, getEnv, llm, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

const log = childLogger('worker:extract');

interface ExtractWorkerDeps {
  db: Db;
}

const RECENT_CONTEXT_LIMIT = 5;

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
  source: string;
  visibility: 'private' | 'team' | 'specific_users';
  sourceMetadata: unknown;
}

/**
 * Build the `model_version` tag persisted with each fact. Combines the model
 * id with a short code-rev hash so prompt or schema changes can be detected
 * by the re-extraction script even when the model id is unchanged.
 */
const EXTRACTION_CODE_VERSION = '2026-05-a';
function makeModelVersion(modelId: string): string {
  return `${modelId}@${EXTRACTION_CODE_VERSION}`;
}

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
export function startExtractWorker(deps: ExtractWorkerDeps): Worker<queue.ExtractJobData> {
  const worker = new Worker<queue.ExtractJobData>(
    queue.QUEUE_NAMES.extract,
    async (job: Job<queue.ExtractJobData>) => {
      const { rawEventId, teamId } = job.data;

      const env = getEnv();
      // Fail fast on missing key so retries don't compound under a permanent
      // misconfiguration. Each retry would re-fetch the row and re-build the
      // prompt only to fail at the LLM call; better to mark the row
      // permanently failed and stop wasting cycles.
      if (!env.OPENROUTER_API_KEY) {
        throw new UnrecoverableError(
          `extract: OPENROUTER_API_KEY not configured; cannot run extraction`,
        );
      }
      const modelId = env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
      const modelVersion = makeModelVersion(modelId);

      // Cross-process idempotency. Two extract workers (or two retries on
      // different nodes) racing the same rawEventId would both pass the
      // "existing facts?" check and both call the LLM, producing duplicate
      // fact bundles because LLM output is non-deterministic. A Postgres
      // advisory lock serialises by rawEventId across processes; the lock
      // releases on transaction end so we hold it for the whole write.
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
      if (!row) {
        throw new UnrecoverableError(`raw event ${rawEventId} not found`);
      }
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
        throw new UnrecoverableError(
          `raw event ${rawEventId} has no content_text; nothing to extract`,
        );
      }

      // Hard privacy gate. Non-team-visibility events never have their body
      // transmitted to the LLM provider. A user who marked a note `private`
      // or `specific_users` did so to keep its content inside the boundary
      // they chose; sending the body to OpenRouter for extraction would
      // violate that, AND derived entities would surface in the shared
      // /app/entities index where everyone on the team could see them.
      // Stamp the metadata with the skip reason so the reextract script
      // does not re-enqueue this row on each run.
      if (row.visibility !== 'team') {
        const skipPatch = JSON.stringify({
          extraction_skipped_at: new Date().toISOString(),
          extraction_skipped_reason: `visibility=${row.visibility}`,
          extraction_model_version: makeModelVersion(
            env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini',
          ),
        });
        await deps.db
          .update(rawEvents)
          .set({
            sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'extraction_failed_at' - 'extraction_error') || ${skipPatch}::jsonb`,
          })
          .where(eq(rawEvents.id, rawEventId));
        return { rawEventId, skipped: true, reason: `visibility=${row.visibility}` };
      }

      // Idempotency via metadata, not via facts existence. The LLM legitimately
      // returns zero facts for some events ("Headed out"); a facts-only check
      // would re-extract those forever. The stamp on raw_events records that
      // we ran this row at this model_version, regardless of fact count.
      const meta =
        row.sourceMetadata && typeof row.sourceMetadata === 'object'
          ? (row.sourceMetadata as Record<string, unknown>)
          : {};
      if (meta.extraction_model_version === modelVersion) {
        return { rawEventId, skipped: true, modelVersion };
      }

      // Context fed to the LLM MUST respect row-level visibility. Without this
      // filter, a private note by user A would be sent to OpenRouter when
      // user B's later note triggers extraction. Worker has no per-user
      // context, so the safest predicate is `visibility = 'team'`: drop both
      // `private` and `specific_users` rows from the context window.
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

      const prompt = extract.buildExtractionPrompt({
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
      });

      const result = await llm.chatStructured({
        schema: extract.extractionResultSchema,
        prompt,
        system: extract.EXTRACTION_SYSTEM_PROMPT,
        model: modelId,
      });

      // Resolve every mention to an entity id BEFORE we open the locked
      // transaction. resolveEntity's insert/re-SELECT is race-safe under
      // the (team, type, lower(name)) partial unique index, so each lookup
      // is auto-commit-safe on its own. Doing this here means the locked
      // write transaction holds for local DB time only, never for LLM
      // latency (disambiguation can call chatStructured again, which would
      // otherwise pin the connection and advisory lock for seconds).
      const resolvedFacts: {
        statement: string;
        confidence: number;
        entityIds: string[];
        mentions: (typeof result.object.facts)[number]['mentions'];
      }[] = [];
      for (const fact of result.object.facts) {
        const entityIds = await extract.resolveMentions(
          deps.db,
          teamId,
          fact.mentions,
          fact.statement,
        );
        resolvedFacts.push({
          statement: fact.statement,
          confidence: fact.confidence,
          entityIds,
          mentions: fact.mentions,
        });
      }

      // Local-only writes inside the locked transaction. Entity rows already
      // exist (resolved above); we only insert facts + fact_entities + stamp
      // metadata. No network calls.
      let factsInserted = 0;
      const insertedFactIds: string[] = [];
      await deps.db.transaction(async (tx) => {
        // Serialise across worker processes. The advisory lock auto-releases
        // at transaction end. Held only for local DB writes (milliseconds),
        // never for LLM latency.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
        // Re-check after acquiring the lock — another worker may have
        // finished extraction while we were waiting. Check via the
        // metadata stamp so zero-fact runs are correctly recognised.
        const recheck = (await tx
          .select({ sourceMetadata: rawEvents.sourceMetadata })
          .from(rawEvents)
          .where(eq(rawEvents.id, rawEventId))
          .limit(1)) as { sourceMetadata: unknown }[];
        const recheckMeta =
          recheck[0]?.sourceMetadata && typeof recheck[0].sourceMetadata === 'object'
            ? (recheck[0].sourceMetadata as Record<string, unknown>)
            : {};
        if (recheckMeta.extraction_model_version === modelVersion) return;
        for (const fact of resolvedFacts) {
          const insertedFacts = await tx
            .insert(factsTable)
            .values({
              teamId,
              rawEventId,
              statement: fact.statement,
              confidence: fact.confidence,
              modelVersion,
            })
            .onConflictDoNothing()
            .returning({ id: factsTable.id });
          const factRow = insertedFacts[0];
          if (!factRow) continue; // duplicate statement under same modelVersion
          factsInserted += 1;
          insertedFactIds.push(factRow.id);
          const seen = new Set<string>();
          for (let i = 0; i < fact.mentions.length; i += 1) {
            const m = fact.mentions[i];
            const entityId = fact.entityIds[i];
            if (!m || !entityId) continue;
            const key = `${entityId}:${m.role}`;
            if (seen.has(key)) continue;
            seen.add(key);
            await tx
              .insert(factEntities)
              .values({ factId: factRow.id, entityId, role: m.role })
              .onConflictDoNothing();
          }
        }

        const patch = JSON.stringify({
          extracted_at: new Date().toISOString(),
          extraction_model_version: modelVersion,
        });
        // Strip any stale failure markers from prior enqueue failures or
        // crashed runs — otherwise the timeline UI keeps showing
        // "extraction unavailable" for a row that has now succeeded.
        await tx
          .update(rawEvents)
          .set({
            sourceMetadata: sql`(COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) - 'extraction_failed_at' - 'extraction_error') || ${patch}::jsonb`,
          })
          .where(eq(rawEvents.id, rawEventId));
      });

      try {
        await queue.enqueueSuggestionJob({ rawEventId, teamId });
      } catch (err) {
        log.error({ err, rawEventId }, 'failed to enqueue suggestion job');
      }

      // Enqueue embed jobs AFTER the transaction commits. One job for the
      // raw event body (covers events with zero facts; same point id is reused
      // on retry) and one per newly-inserted fact. Failures here are logged
      // but never fail the extract job — facts are already durable and the
      // reembed script can backfill. Stamp a marker so the timeline UI can
      // surface "embedding unavailable" the same way extract failures do.
      // Enqueue each embed job independently — a single try/catch around the
      // whole loop would short-circuit on the first failure and skip every
      // subsequent fact, silently leaving them un-embedded until a reembed
      // run. Collect failures and stamp ONE event-scope marker at the end if
      // any of them broke; the reembed script is the durable backfill path.
      const enqueueFailures: { factId: string | null; err: unknown }[] = [];
      try {
        await queue.enqueueEmbedJob({ rawEventId, teamId });
      } catch (err) {
        enqueueFailures.push({ factId: null, err });
      }
      for (const factId of insertedFactIds) {
        try {
          await queue.enqueueEmbedJob({ rawEventId, teamId, factId });
        } catch (err) {
          enqueueFailures.push({ factId, err });
        }
      }
      if (enqueueFailures.length > 0) {
        for (const f of enqueueFailures) {
          log.error({ factId: f.factId ?? 'event', err: f.err }, 'embed enqueue failed');
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
          });
      }

      return { rawEventId, factsInserted, modelVersion };
    },
    {
      connection: queue.getRedisConnection(),
      // One in-flight extraction per process. Extraction is heavier than
      // transcription per job and benefits less from parallelism.
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
    if (!job) return;
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
      });
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });

  return worker;
}
