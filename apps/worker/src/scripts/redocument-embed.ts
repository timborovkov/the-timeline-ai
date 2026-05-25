/**
 * Re-embed document chunks script (Phase 9).
 *
 * Walks document_chunks for one team and enqueues per-chunk embed jobs.
 * Use after changing the embedding model (`EMBEDDING_MODEL` env or its
 * dimensions) — point ids are deterministic over (chunkId, model), so a
 * new model writes a new point alongside the old one. With
 * --target-collection, the new points land in a fresh collection that
 * the operator created at the new vector dimensions (mirrors the reembed
 * cutover pattern).
 *
 * Usage:
 *   pnpm --filter @timeline/worker redocument-embed -- \
 *     --team=<uuid> [--target-collection=<name>] [--limit=N] [--dry-run]
 */
import { closeDb, documentChunks, documents, documentVersions, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';
import { and, asc, eq, gt, isNull, or, type SQL } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;

interface Args {
  teamId: string;
  limit: number;
  dryRun: boolean;
  targetCollection?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  let targetCollection: string | undefined;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--target-collection=')) {
      targetCollection = arg.slice('--target-collection='.length);
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: redocument-embed --team=<uuid> [--target-collection=<name>] [--limit=N] [--dry-run]',
    );
    process.exit(2);
  }
  const result: Args = { teamId, limit, dryRun };
  if (targetCollection) result.targetCollection = targetCollection;
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();
  let cursor: { createdAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < args.limit) {
    const conditions: SQL[] = [
      eq(documentChunks.teamId, args.teamId),
      // Skip chunks whose parent document is soft-deleted — the agent
      // shouldn't be able to retrieve them, and the deleteDocument path
      // separately flushes existing Qdrant points.
      isNull(documents.deletedAt),
    ];
    if (cursor) {
      conditions.push(
        or(
          gt(documentChunks.createdAt, cursor.createdAt),
          and(eq(documentChunks.createdAt, cursor.createdAt), gt(documentChunks.id, cursor.id)),
        )!,
      );
    }
    const page = await db
      .select({
        id: documentChunks.id,
        createdAt: documentChunks.createdAt,
        sourceEventId: documentVersions.sourceEventId,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documents.id, documentChunks.documentId))
      .innerJoin(documentVersions, eq(documentVersions.id, documentChunks.documentVersionId))
      .where(and(...conditions))
      .orderBy(asc(documentChunks.createdAt), asc(documentChunks.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) break;
    scanned += page.length;
    for (const row of page) {
      if (enqueued >= args.limit) break;
      if (args.dryRun) {
        console.log(`[dry-run] would enqueue embed for chunk ${row.id}`);
      } else {
        await queue.enqueueEmbedJob({
          scope: 'doc_chunk',
          teamId: args.teamId,
          documentChunkId: row.id,
          ...(args.targetCollection ? { targetCollection: args.targetCollection } : {}),
        });
      }
      enqueued++;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  console.log(
    `redocument-embed done: team=${args.teamId} scanned=${String(scanned)} enqueued=${String(enqueued)} dryRun=${String(args.dryRun)} targetCollection=${args.targetCollection ?? '<default>'}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void closeDb();
    void queue.closeEmbedQueue();
    void queue.closeRedisConnection();
  });
