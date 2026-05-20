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

      const rows = (await deps.db
        .select({
          id: rawEvents.id,
          teamId: rawEvents.teamId,
          contentText: rawEvents.contentText,
          occurredAt: rawEvents.occurredAt,
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

      const env = getEnv();
      const modelId = env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
      const modelVersion = makeModelVersion(modelId);

      const existing = await deps.db
        .select({ id: factsTable.id })
        .from(factsTable)
        .where(
          and(eq(factsTable.rawEventId, rawEventId), eq(factsTable.modelVersion, modelVersion)),
        )
        .limit(1);
      if (existing.length > 0) {
        return { rawEventId, skipped: true, modelVersion };
      }

      const recentRows = (await deps.db
        .select({
          contentText: rawEvents.contentText,
          occurredAt: rawEvents.occurredAt,
        })
        .from(rawEvents)
        .where(and(eq(rawEvents.teamId, teamId), lt(rawEvents.occurredAt, row.occurredAt)))
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

      // Persist everything in one transaction. Entity upserts, fact inserts,
      // and the metadata stamp on raw_events all succeed or fail together.
      let factsInserted = 0;
      await deps.db.transaction(async (tx) => {
        for (const fact of result.object.facts) {
          const entityIds = await extract.resolveMentions(
            tx,
            teamId,
            fact.mentions,
            fact.statement,
          );
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
            const entityId = entityIds[i];
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
        await tx
          .update(rawEvents)
          .set({
            sourceMetadata: sql`COALESCE(${rawEvents.sourceMetadata}, '{}'::jsonb) || ${patch}::jsonb`,
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
