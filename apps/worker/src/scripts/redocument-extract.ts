/**
 * Re-extract documents script (Phase 9).
 *
 * Walks document_versions for one team and enqueues documentExtract jobs.
 * Use after changing the chunker (`packages/shared/src/chunk.ts`), the
 * EXTRACT_CODE_VERSION tag, or adding a new content-type extractor —
 * versions whose chunks were produced under the old policy get re-driven.
 *
 * Idempotency comes from the documentExtract worker itself:
 *   - already-`chunked` / `embedded` versions skip unless --force is set
 *     (the worker checks status; --force resets status='pending' before
 *     enqueue so the next pass re-runs cleanly).
 *   - the chunk insert deletes prior chunks for the version in the same
 *     transaction, so a partial mid-flight crash leaves no orphans.
 *
 * Usage:
 *   pnpm --filter @timeline/worker redocument-extract -- \
 *     --team=<uuid> \
 *     [--status=<comma-separated>] [--limit=N] [--dry-run] [--force]
 */
import { closeDb, documentVersions, getDb } from '@timeline/db';
import { queue } from '@timeline/shared';
import { and, asc, eq, gt, inArray, or, type SQL, sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 500;
type ProcessingStatus = 'pending' | 'extracting' | 'chunked' | 'embedded' | 'deferred' | 'failed';
const VALID_STATUSES: ProcessingStatus[] = [
  'pending',
  'extracting',
  'chunked',
  'embedded',
  'deferred',
  'failed',
];

interface Args {
  teamId: string;
  status: ProcessingStatus[];
  limit: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let teamId: string | undefined;
  let status: ProcessingStatus[] = ['failed'];
  let limit = Number.POSITIVE_INFINITY;
  let dryRun = false;
  let force = false;
  for (const arg of args) {
    if (arg.startsWith('--team=')) teamId = arg.slice('--team='.length);
    else if (arg.startsWith('--status=')) {
      const raw = arg
        .slice('--status='.length)
        .split(',')
        .map((s) => s.trim());
      const filtered = raw.filter((s): s is ProcessingStatus =>
        (VALID_STATUSES as string[]).includes(s),
      );
      if (filtered.length > 0) status = filtered;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(parsed) && parsed > 0) limit = parsed;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    }
  }
  if (!teamId || !UUID_RE.test(teamId)) {
    console.error(
      'Usage: redocument-extract --team=<uuid> [--status=pending,failed,...] [--limit=N] [--dry-run] [--force]',
    );
    process.exit(2);
  }
  return { teamId, status, limit, dryRun, force };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = getDb();
  let cursor: { createdAt: Date; id: string } | null = null;
  let enqueued = 0;
  let scanned = 0;

  while (enqueued < args.limit) {
    const conditions: SQL[] = [
      eq(documentVersions.teamId, args.teamId),
      inArray(documentVersions.processingStatus, args.status),
    ];
    if (cursor) {
      // (createdAt, id) tuple cursor — stable across ties on createdAt.
      const tupleCondition = or(
        gt(documentVersions.createdAt, cursor.createdAt),
        and(eq(documentVersions.createdAt, cursor.createdAt), gt(documentVersions.id, cursor.id)),
      );
      if (tupleCondition) conditions.push(tupleCondition);
    }
    const page = await db
      .select({
        id: documentVersions.id,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(and(...conditions))
      .orderBy(asc(documentVersions.createdAt), asc(documentVersions.id))
      .limit(PAGE_SIZE);
    if (page.length === 0) break;
    scanned += page.length;
    for (const row of page) {
      if (enqueued >= args.limit) break;
      if (args.dryRun) {
        console.log(`[dry-run] would enqueue documentExtract for ${row.id}`);
      } else {
        if (args.force) {
          await db
            .update(documentVersions)
            .set({ processingStatus: 'pending', processingError: null })
            .where(eq(documentVersions.id, row.id));
        }
        await queue.enqueueDocumentExtractJob({
          documentVersionId: row.id,
          teamId: args.teamId,
        });
      }
      enqueued++;
    }
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  console.log(
    `redocument-extract done: team=${args.teamId} scanned=${String(scanned)} enqueued=${String(enqueued)} dryRun=${String(args.dryRun)}`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void closeDb();
    void queue.closeDocumentExtractQueue();
    void queue.closeRedisConnection();
    // Silence the "unused sql import" hint — sql is reserved for the
    // optional --since predicate if a later flag adds one.
    void sql;
  });
