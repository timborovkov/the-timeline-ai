import { type Db, documentChunks, documents, documentVersions } from '@timeline/db';
import {
  childLogger,
  chunkText,
  getDocumentsBucket,
  getEnv,
  getObjectBuffer,
  getS3Client,
  llm,
  queue,
} from '@timeline/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import mammoth from 'mammoth';

import { captureWorkerJobFailure } from '#src/monitoring.js';

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
  /**
   * Run vision-based OCR / transcription on a binary document. Defaults
   * to `llm.extractTextFromMedia` (OpenRouter vision model). Tests inject
   * a fake so they can exercise the routing without hitting OpenRouter.
   */
  extractFromMedia: (input: {
    body: Buffer;
    mediaType: string;
    filename: string;
  }) => Promise<{ text: string; visualDescription?: string; model: string }>;
  /**
   * Native DOCX text extraction via mammoth. Splitting this out from
   * the worker body lets tests assert routing without needing a real
   * .docx payload. Defaults to `mammoth.extractRawText`.
   */
  extractDocx: (body: Buffer) => Promise<{ text: string }>;
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
    async extractFromMedia(input) {
      return llm.extractTextFromMedia({
        body: input.body,
        mediaType: input.mediaType,
        filename: input.filename,
      });
    },
    async extractDocx(body) {
      // mammoth.extractRawText drops styles + structure but keeps reading
      // order — best fit for retrieval. Pass-through warnings array is
      // ignored; mammoth surfaces things like "unrecognised paragraph
      // style" which don't change the text.
      const result = await mammoth.extractRawText({ buffer: body });
      return { text: result.value };
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
interface DocumentExtractResult {
  documentVersionId: string;
  chunkCount?: number;
  skipped?: boolean;
  reason?: string;
}

type RepresentationKind = 'source_text' | 'transcript' | 'visual_description' | 'metadata_preview';

interface ExtractedRepresentation {
  kind: RepresentationKind;
  text: string;
}

function metadataPreviewText(input: {
  label: 'Captured file' | 'Document';
  name: string;
  contentType: string | null;
  byteSize: number | null;
  reason: string;
}): string {
  return [
    `${input.label}: ${input.name}`,
    input.contentType ? `Content type: ${input.contentType}` : null,
    input.byteSize !== null ? `Size: ${String(input.byteSize)} bytes` : null,
    input.reason,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
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
    .where(and(eq(documentVersions.id, documentVersionId), eq(documentVersions.teamId, teamId)))
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

  // Race-safe ownership claim: take the advisory lock, re-read the
  // status under the lock, and only flip pending → extracting if no
  // other worker beat us to it. Without the under-lock re-read, two
  // concurrent jobs for the same versionId both pass the idempotency
  // check (each sees the stale 'pending' from before the lock) and
  // both burn through the vision LLM. The lock + re-read makes the
  // second worker bail cheap.
  const claim = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const fresh = await tx
      .select({ status: documentVersions.processingStatus })
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id))
      .limit(1);
    const status = fresh[0]?.status;
    if (status === 'chunked' || status === 'embedded' || status === 'extracting') {
      // Either a sibling worker is in flight (extracting) or already
      // finished (chunked/embedded). Replays from the
      // redocument-extract script intentionally re-enter here; the
      // operator must reset the status to 'pending' first if they
      // want a true re-extract.
      return { skipped: true, reason: 'already_processed' as const };
    }
    await tx
      .update(documentVersions)
      .set({ processingStatus: 'extracting', processingError: null })
      .where(eq(documentVersions.id, version.id));
    return { skipped: false };
  });
  if (claim.skipped) {
    return {
      documentVersionId,
      skipped: true,
      reason: claim.reason ?? 'already_processed',
    };
  }

  if (version.byteSize !== null && version.byteSize > MAX_DOCUMENT_BYTES) {
    const preview =
      document.fileKind === 'captured'
        ? metadataPreviewText({
            label: 'Captured file',
            name: document.name,
            contentType: version.contentType,
            byteSize: version.byteSize,
            reason: 'Deep extraction deferred until promotion or targeted inspection.',
          })
        : metadataPreviewText({
            label: 'Document',
            name: document.name,
            contentType: version.contentType,
            byteSize: version.byteSize,
            reason: 'Deep extraction deferred because the file exceeds the current extraction cap.',
          });
    const insertedIds = await deps.db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.documentVersionId, version.id));
      const inserted = await tx
        .insert(documentChunks)
        .values({
          teamId,
          documentId: document.id,
          documentVersionId: version.id,
          chunkIndex: 0,
          representationKind: 'metadata_preview',
          text: preview,
          tokenCount: chunkText(preview)[0]?.tokenCount ?? Math.ceil(preview.length / 4),
        })
        .returning({ id: documentChunks.id });
      await tx
        .update(documentVersions)
        .set({
          processingStatus: 'deferred',
          processingError:
            document.fileKind === 'captured'
              ? 'deep extraction deferred by captured-file budget'
              : 'deep extraction deferred by document extraction cap',
          extractionModelVersion: EXTRACT_CODE_VERSION,
        })
        .where(eq(documentVersions.id, version.id));
      return inserted.map((row) => row.id);
    });
    for (const chunkId of insertedIds) {
      await io.enqueueEmbed({
        scope: 'doc_chunk',
        teamId,
        documentChunkId: chunkId,
        ...(targetCollection ? { targetCollection } : {}),
      });
    }
    return { documentVersionId, chunkCount: 1, skipped: true, reason: 'deferred_budget' };
  }

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
  // Extension fallback for routing must use the ORIGINAL uploaded
  // filename, not document.name — the latter is the user-facing display
  // (e.g. "Acme MSA") and frequently has no extension. The sanitised
  // upload filename is the last segment of the versioned object key
  // (see buildDocumentObjectKey: `<team>/<doc>/v<n>/<filename>`). Fall
  // back to document.name only if the key shape is unexpected.
  // `||` not `??` here — pop()?.trim() can return an empty string,
  // which is meaningless for extension routing. Empty-string and
  // undefined both fall through to document.name.
  const objectKeyTail = version.objectKey.split('/').pop()?.trim();
  const filenameForRouting =
    objectKeyTail && objectKeyTail.length > 0 ? objectKeyTail : document.name;
  let representations: ExtractedRepresentation[];
  let extractionModel: string = EXTRACT_CODE_VERSION;
  try {
    const routed = await routeContentToText({ contentType, body, name: filenameForRouting }, io);
    if ('failure' in routed) {
      // Honest reason — routeContentToText distinguishes "unsupported
      // mediaType" from "binary content masquerading as text" so the
      // operator sees the actual diagnosis on the version row, not a
      // confusing "text/plain not supported".
      await deps.db
        .update(documentVersions)
        .set({ processingStatus: 'failed', processingError: routed.failure })
        .where(eq(documentVersions.id, version.id));
      // Don't retry — adding an extractor or fixing the upload changes
      // the input, not the policy. UnrecoverableError stops the BullMQ
      // retry loop.
      throw new UnrecoverableError(routed.failure);
    }
    representations = routed.representations;
    if (routed.model) extractionModel = routed.model;
  } catch (err: unknown) {
    // Already stamped above for the routed-failure branch.
    if (err instanceof UnrecoverableError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: message.slice(0, 500) })
      .where(eq(documentVersions.id, version.id));
    // Transient LLM / mammoth errors bubble up so BullMQ retries. The
    // version row records the last error so the operator sees progress.
    throw err;
  }

  const nonEmptyRepresentations = representations
    .map((representation) => ({ ...representation, text: representation.text.trim() }))
    .filter((representation) => representation.text.length > 0);
  if (nonEmptyRepresentations.length === 0) {
    const reason = 'no text extracted';
    await deps.db
      .update(documentVersions)
      .set({ processingStatus: 'failed', processingError: reason })
      .where(eq(documentVersions.id, version.id));
    throw new UnrecoverableError(reason);
  }

  const chunks = nonEmptyRepresentations
    .flatMap((representation) =>
      chunkText(representation.text).map((chunk) => ({ ...chunk, kind: representation.kind })),
    )
    .map((chunk, index) => ({ ...chunk, index }));
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
          representationKind: c.kind,
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
        // Stamp both the code-rev tag AND the model id (when vision was
        // used) so the redocument-extract script can re-pick versions
        // whose extractor changed without forcing a full re-extract of
        // text-only documents.
        extractionModelVersion:
          extractionModel === EXTRACT_CODE_VERSION
            ? EXTRACT_CODE_VERSION
            : `${EXTRACT_CODE_VERSION}+${extractionModel}`,
      })
      .where(eq(documentVersions.id, version.id));
    return inserted.map((r) => r.id);
  });

  // Fan out embed jobs. Each chunk's embed point id is deterministic
  // (sha256 of scope + chunkId + model), so duplicate enqueues are safe.
  // Uses the doc_chunk variant of the post-Phase-8 discriminated union.
  for (const chunkId of insertedIds) {
    await io.enqueueEmbed({
      scope: 'doc_chunk',
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
    captureWorkerJobFailure(err, job);
  });
  worker.on('completed', (job) => {
    log.info({ jobId: job.id }, 'job completed');
  });
  return worker;
}

/**
 * Route a document body to plain text. Returns `{ text: null }` when no
 * extractor matches — the caller stamps the version row 'failed' and
 * the operator can revisit.
 *
 * Routes:
 *   - text/*, json, xml, recognised text-ish extensions → utf-8 read +
 *     NUL-byte heuristic against accidentally treating binary as text.
 *   - application/pdf, image/* → `io.extractFromMedia` (vision LLM via
 *     OpenRouter). Returns the model id so the version row records
 *     which model produced the text.
 *   - DOCX (Office Open XML) → `io.extractDocx` (mammoth raw-text).
 *     Native extraction is faster and free; vision is reserved for
 *     formats that need OCR.
 *   - Anything else → `{ failure }` with an honest reason string. Two
 *     failure modes the caller must distinguish:
 *       * "content_type=… not supported" — no extractor for the MIME
 *       * "binary content detected in text-declared upload" — file
 *         claimed text/* but has NUL bytes in the head (operator
 *         likely uploaded a binary with the wrong Content-Type)
 */
type RouteResult =
  | { representations: ExtractedRepresentation[]; model?: string }
  | { failure: string };

async function routeContentToText(
  input: { contentType: string; body: Buffer; name: string },
  io: DocumentExtractIO,
): Promise<RouteResult> {
  const ct = input.contentType;
  // Text-ish routes first. These are cheapest and zero LLM cost.
  if (
    ct.startsWith('text/') ||
    ct === 'application/json' ||
    ct === 'application/xml' ||
    /\.(md|markdown|txt|csv|tsv|json|yaml|yml|log|html?)$/i.test(input.name)
  ) {
    const text = input.body.toString('utf-8');
    // Quick guard against accidentally treating a binary file as text
    // (would have garbled tokens). Reject if the first 1 KB contains
    // many NUL bytes — a heuristic, not a guarantee. The failure
    // reason names what's actually wrong (binary content) rather than
    // claiming the MIME isn't supported.
    const head = text.slice(0, 1024);
    let nul = 0;
    for (let i = 0; i < head.length; i++) {
      if (head.charCodeAt(i) === 0) nul++;
      if (nul > 8) {
        return {
          failure: `binary content detected in text-declared upload (content_type=${ct || 'unknown'})`,
        };
      }
    }
    return { representations: [{ kind: 'source_text', text }] };
  }
  // DOCX (Office Open XML) — native extraction via mammoth. Note: the
  // MIME for .docx is the full ms-office identifier. Old-school .doc
  // (binary BIFF) is NOT mammoth's domain and remains unsupported.
  if (
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(input.name)
  ) {
    const { text } = await io.extractDocx(input.body);
    return { representations: [{ kind: 'source_text', text }] };
  }
  // PDF and image routes both go through the vision model. Vision can
  // also handle scanned PDFs (no text layer) and screenshots without us
  // needing to detect which kind we have.
  if (ct === 'application/pdf' || /\.pdf$/i.test(input.name)) {
    const result = await io.extractFromMedia({
      body: input.body,
      mediaType: 'application/pdf',
      filename: input.name,
    });
    return mediaRepresentations(result, true);
  }
  // Image extension fallback matches the PDF/DOCX behaviour above: when
  // RustFS loses the explicit Content-Type on PUT we still route the
  // upload through vision via the filename extension. ai-sdk's vision
  // content-part `mediaType` needs a real MIME, so derive one from the
  // extension rather than passing octet-stream through.
  const IMAGE_EXT_TO_MIME: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
  };
  const extMatch = /\.([a-z0-9]+)$/i.exec(input.name);
  const extLower = extMatch?.[1]?.toLowerCase();
  const fallbackImageMime = extLower ? IMAGE_EXT_TO_MIME[extLower] : undefined;
  if (ct.startsWith('image/') || fallbackImageMime) {
    const result = await io.extractFromMedia({
      body: input.body,
      mediaType: ct.startsWith('image/') ? ct : (fallbackImageMime ?? 'image/png'),
      filename: input.name,
    });
    return mediaRepresentations(result, true);
  }
  // audio/video and anything else: out of scope for the extract worker.
  // Audio goes through the transcribe worker; video has no route yet.
  return {
    failure: `content_type=${ct || 'unknown'} not supported`,
  };
}

function mediaRepresentations(
  result: { text: string; visualDescription?: string; model: string },
  includeVisualDescription: boolean,
): RouteResult {
  const representations: ExtractedRepresentation[] = [];
  if (result.text.trim()) {
    representations.push({ kind: 'source_text', text: result.text });
  }
  if (includeVisualDescription && result.visualDescription?.trim()) {
    representations.push({ kind: 'visual_description', text: result.visualDescription });
  }
  return { representations, model: result.model };
}
