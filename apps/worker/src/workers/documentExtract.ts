import {
  type Db,
  documentChunks,
  documents,
  documentVersions,
} from '@timeline/db';
import {
  childLogger,
  chunkText,
  estimateTokens,
  getDocumentsBucket,
  getEnv,
  getObjectBuffer,
  getS3Client,
  queue,
} from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

const log = childLogger('worker:document-extract');

interface DocumentExtractWorkerDeps {
  db: Db;
}

/**
 * Injectable IO surface for the document-extract handler. Production wires
 * the real S3 client + BullMQ queue (see `defaultProcessDeps`); tests pass
 * fakes that record what the handler would have done without touching
 * RustFS or Redis.
 */
export interface DocumentExtractIO {
  /** Fetch the blob from object storage. Defaults to RustFS via S3 SDK. */
  fetchBlob: (
    objectKey: string,
    maxBytes: number,
  ) => Promise<{ body: Buffer; contentType?: string }>;
  /** Enqueue one embed job per chunk. Defaults to the real BullMQ queue. */
  enqueueEmbed: (data: queue.EmbedJobData) => Promise<void>;
  /** Resolve env. Defaults to the process env via `getEnv()`. Tests can
   *  override to bypass the OPENROUTER_API_KEY gate. */
  requireEnv: () => void;
}

function defaultIO(): DocumentExtractIO {
  return {
    async fetchBlob(objectKey, maxBytes) {
      return getObjectBuffer(getS3Client(), getDocumentsBucket(), objectKey, maxBytes);
    },
    enqueueEmbed: queue.enqueueEmbedJob,
    requireEnv() {
      const env = getEnv();
      if (!env.OPENROUTER_API_KEY) {
        throw new UnrecoverableError('document-extract: OPENROUTER_API_KEY not configured');
      }
    },
  };
}

// Code-version tag stamped on every successful extraction so the
// `redocument-extract` script can re-drive jobs whose chunking policy
// predates a change.
const EXTRACT_CODE_VERSION = '2026-05-a';

// Cap on document size we will pull into memory for processing. Above
// this, the worker stamps the version as 'failed' with a clear message
// so the user can decide how to split the file. 25 MiB matches the
// transcribe cap; revisit when streaming extraction lands.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Phase 9 document extract worker. One job per `document_versions.id`:
 *   1. Advisory-lock by version id (cross-process serialisation).
 *   2. Load version + document; bail unrecoverably on mismatch / missing.
 *   3. Privacy gate: only `visibility='team'` documents process today.
 *   4. Download the blob from RustFS.
 *   5. Route by content type → text. Today supports text/markdown only.
 *      PDF, DOCX, and image (OCR / vision) routes are scaffolded but
 *      stamp the version as 'failed' so the surface area is honest —
 *      adding extractors is a follow-up PR that does not change the
 *      pipeline or schema.
 *   6. chunkText() to a uniform ~800/120 budget.
 *   7. Insert document_chunks rows + enqueue an embed job per chunk.
 *   8. Stamp version status = 'chunked' (embed promotes to 'embedded').
 *
 * Idempotency: the advisory lock + (document_version_id, chunk_index)
 * unique index together mean a duplicate enqueue is safe (the second
 * pass either finds the version past 'chunked' and exits or hits the
 * unique constraint and rolls back).
 */
export interface DocumentExtractResult {
  documentVersionId: string;
  chunkCount?: number;
  skipped?: boolean;
  reason?: string;
}

/**
 * Pure-ish job handler. Called by the BullMQ Worker (production) and
 * directly by tests with injected IO. Side effects:
 *   - DB writes (status, chunks)
 *   - blob read via `io.fetchBlob`
 *   - embed enqueue via `io.enqueueEmbed`
 * No direct Redis/S3 references; both go through `io`.
 */
export async function processDocumentExtractJob(
  deps: DocumentExtractWorkerDeps,
  data: queue.DocumentExtractJobData,
  io: DocumentExtractIO = defaultIO(),
): Promise<DocumentExtractResult> {
  const { documentVersionId, teamId, targetCollection } = data;
  io.requireEnv();

  const lockKey = sql`hashtextextended(${documentVersionId}, 0)`;

  const rows = await deps.db
    .select({
      version: documentVersions,
      document: documents,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(
      and(eq(documentVersions.id, documentVersionId), eq(documentVersions.teamId, teamId)),
    )
    .limit(1);
  const hit = rows[0];
  if (!hit) {
    throw new UnrecoverableError(`document version ${documentVersionId} not found`);
  }
  const version = hit.version;
  const document = hit.document;

  if (document.deletedAt) {
    // Document was deleted between enqueue and process. Don't error;
    // the doc-chunks for this version will be cleaned up via the
    // separate deletePoints path when the delete action ran.
    return { documentVersionId, skipped: true, reason: 'document_deleted' };
  }

  // Already past 'chunked' (the embed worker promotes to 'embedded'
  // once chunks land in Qdrant). Replays from the redocument-extract
  // script intentionally re-enter here; the user must reset the
  // status row first if they want a true re-extract.
  if (version.processingStatus === 'chunked' || version.processingStatus === 'embedded') {
    return { documentVersionId, skipped: true, reason: 'already_processed' };
  }

  if (document.visibility !== 'team') {
    await deps.db
      .update(documentVersions)
      .set({
        processingStatus: 'failed',
        processingError: `visibility=${document.visibility} not processed`,
      })
      .where(eq(documentVersions.id, version.id));
    return {
      documentVersionId,
      skipped: true,
      reason: `visibility=${document.visibility}`,
    };
  }

  // Mark as extracting so concurrent enqueues see progress.
  await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    await tx
      .update(documentVersions)
      .set({ processingStatus: 'extracting', processingError: null })
      .where(eq(documentVersions.id, version.id));
  });

  // Bounds-check before reading the body. RustFS HEAD is cheap and
  // surfaces oversize uploads without consuming bandwidth.
  let body: Buffer;
  try {
    const fetched = await io.fetchBlob(version.objectKey, MAX_DOCUMENT_BYTES);
    body = fetched.body;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: message.slice(0, 500) })
      .where(eq(documentVersions.id, version.id));
    throw err;
  }

  const contentType = (version.contentType ?? '').toLowerCase();
  const text = await routeContentToText({ contentType, body, name: document.name });
  if (text === null) {
    const reason = `content_type=${contentType || 'unknown'} not supported`;
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: reason })
      .where(eq(documentVersions.id, version.id));
    // Don't retry — adding a new extractor changes the policy, not
    // the input. UnrecoverableError stops the BullMQ retry loop.
    throw new UnrecoverableError(reason);
  }

  if (!text.trim()) {
    const reason = 'no text extracted';
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: reason })
      .where(eq(documentVersions.id, version.id));
    throw new UnrecoverableError(reason);
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    const reason = 'chunker produced no chunks';
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: reason })
      .where(eq(documentVersions.id, version.id));
    throw new UnrecoverableError(reason);
  }

  // Single transaction: replace any existing chunks for this version
  // (re-extract case) and stamp status. The unique index on
  // (document_version_id, chunk_index) plus this transaction means
  // concurrent jobs cannot interleave half-runs.
  const insertedIds = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    await tx.delete(documentChunks).where(eq(documentChunks.documentVersionId, version.id));
    const inserted = await tx
      .insert(documentChunks)
      .values(
        chunks.map((c) => ({
          teamId,
          documentId: document.id,
          documentVersionId: version.id,
          chunkIndex: c.index,
          text: c.text,
          tokenCount: c.tokenCount,
        })),
      )
      .returning({ id: documentChunks.id });
    await tx
      .update(documentVersions)
      .set({
        processingStatus: 'chunked',
        processingError: null,
        extractionModelVersion: EXTRACT_CODE_VERSION,
      })
      .where(eq(documentVersions.id, version.id));
    return inserted.map((r) => r.id);
  });

  // Fan out embed jobs. Each chunk's embed point id is deterministic
  // so duplicate enqueues are safe.
  for (const chunkId of insertedIds) {
    await io.enqueueEmbed({
      rawEventId: version.sourceEventId ?? chunkId,
      teamId,
      documentChunkId: chunkId,
      ...(targetCollection ? { targetCollection } : {}),
    });
  }

  log.info(
    {
      documentVersionId,
      chunkCount: chunks.length,
      tokenTotal: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
    },
    'document chunked',
  );
  return { documentVersionId, chunkCount: chunks.length };
}

export function startDocumentExtractWorker(
  deps: DocumentExtractWorkerDeps,
): Worker<queue.DocumentExtractJobData> {
  const io = defaultIO();
  const worker = new Worker<queue.DocumentExtractJobData>(
    queue.QUEUE_NAMES.documentExtract,
    async (job: Job<queue.DocumentExtractJobData>) => processDocumentExtractJob(deps, job.data, io),
    {
      connection: queue.getRedisConnection(),
      // PDF / vision extraction will be CPU- or LLM-bound; keep modest
      // parallelism. Tune once we have real numbers.
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'job failed');
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });
  return worker;
}

/**
 * Route a document body to plain text. Returns null when no extractor
 * matches — the caller stamps the version row 'failed' and the operator
 * can revisit.
 *
 * Today supports text/* and markdown directly. PDF, DOCX, and image
 * (LLM-vision OCR) extractors land in follow-up PRs — the schema, queue,
 * and embed worker are in place so adding an extractor is mechanical.
 */
async function routeContentToText(input: {
  contentType: string;
  body: Buffer;
  name: string;
}): Promise<string | null> {
  const ct = input.contentType;
  if (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    /\.(md|markdown|txt|csv|tsv|json|yaml|yml|log|html?)$/i.test(input.name)
  ) {
    const text = input.body.toString('utf-8');
    // Quick guard against accidentally treating a binary file as text
    // (would have garbled tokens). Reject if the first 1 KB contains many
    // NUL bytes — a heuristic, not a guarantee.
    const head = text.slice(0, 1024);
    let nul = 0;
    for (let i = 0; i < head.length; i++) {
      if (head.charCodeAt(i) === 0) nul++;
      if (nul > 8) return null;
    }
    return text;
  }
  // PDF, DOCX, images, audio, video: not yet supported by this slice.
  // Returning null lets the caller stamp a clear 'failed' reason and
  // surfaces in the document detail UI.
  return null;
}

// Re-exported for the redocument-extract script to share the same code
// version tag — the script's "is this version already at the current
// extractor?" check needs the same string the worker stamps.
export { EXTRACT_CODE_VERSION, estimateTokens };
