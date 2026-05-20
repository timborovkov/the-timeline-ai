/**
 * Re-extraction script. Walks raw_events for a team and enqueues an extract
 * job for any row that lacks facts at the current model_version. Idempotent:
 * rows already at the current version are skipped; the worker itself also
 * re-checks before doing any LLM work.
 *
 * Usage:
 *   pnpm --filter @timeline/worker reextract -- --team=<teamId> [--limit=N]
 *
 * Requires DATABASE_URL and REDIS_URL. OPENROUTER_API_KEY is required at
 * extraction time (in the worker), not here.
 */
import { closeDb, getDb, facts as factsTable, rawEvents } from '@timeline/db';
import { getEnv, queue } from '@timeline/shared';
import { and, eq, isNotNull } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXTRACTION_CODE_VERSION = '2026-05-a';

function parseArgs(): { teamId: string; limit: number } {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = 1000;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.slice('--limit='.length), 10);
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error('Usage: reextract --team=<uuid> [--limit=N]');
    process.exit(2);
  }
  if (!Number.isFinite(limit) || limit <= 0) limit = 1000;
  return { teamId, limit };
}

async function main(): Promise<void> {
  const { teamId, limit } = parseArgs();
  const env = getEnv();
  const modelId = env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
  const modelVersion = `${modelId}@${EXTRACTION_CODE_VERSION}`;
  console.log(`[reextract] team=${teamId} modelVersion=${modelVersion} limit=${limit}`);

  const db = getDb();
  const candidates = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(and(eq(rawEvents.teamId, teamId), isNotNull(rawEvents.contentText)))
    .limit(limit);

  let enqueued = 0;
  let skipped = 0;
  for (const row of candidates) {
    const existing = await db
      .select({ id: factsTable.id })
      .from(factsTable)
      .where(and(eq(factsTable.rawEventId, row.id), eq(factsTable.modelVersion, modelVersion)))
      .limit(1);
    if (existing.length > 0) {
      skipped += 1;
      continue;
    }
    await queue.enqueueExtractJob({ rawEventId: row.id, teamId });
    enqueued += 1;
  }
  console.log(`[reextract] done. enqueued=${enqueued} skipped=${skipped}`);

  // Drain so the script process exits.
  await queue.closeExtractQueue();
  await queue.closeRedisConnection();
  await closeDb();
}

main().catch((err: unknown) => {
  console.error('[reextract] failed', err);
  process.exit(1);
});
