import { type Db, facts as factsTable, factEntities, rawEvents } from '@timeline/db';
import { extract, getEnv, llm, queue } from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, desc, eq, lt, sql } from 'drizzle-orm';

interface ExtractWorkerDeps {
  db: Db;
}

const RECENT_CONTEXT_LIMIT = 5;

interface RawEventRow {
  id: string;
  teamId: string;
  contentText: string | null;
  occurredAt: Date;
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
      const text = row.contentText?.trim();
      if (!text) {
        throw new UnrecoverableError(
          `raw event ${rawEventId} has no content_text; nothing to extract`,
        );
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
        .limit(RECENT_CONTEXT_LIMIT)) as { contentText: string | null; occurredAt: Date }[];

      const prompt = extract.buildExtractionPrompt({
        current: { occurredAt: row.occurredAt.toISOString(), text },
        recent: recentRows
          .filter((r): r is { contentText: string; occurredAt: Date } => Boolean(r.contentText))
          .map((r) => ({ occurredAt: r.occurredAt.toISOString(), text: r.contentText })),
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
    console.error(`[worker:extract] job ${job?.id} failed:`, err.message);
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
        console.error('[worker:extract] failed to mark row failure', updateErr);
      });
  });
  worker.on('completed', (job) => {
    console.log(`[worker:extract] job ${job.id} completed`);
  });

  return worker;
}
