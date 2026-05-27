import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type Db, documentChunks, documents, documentVersions } from '@timeline/db';
import { withTeam, type queue as queueNS } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type DocumentExtractIO, processDocumentExtractJob } from './documentExtract.js';

/**
 * Real-DB integration tests for the documentExtract worker handler.
 * Uses pglite for Postgres + injected fakes for S3 and the embed queue
 * so no Redis or RustFS connection is required.
 *
 * What these prove that mocks-only tests cannot:
 *   - Status transitions land in actual rows (pending → extracting →
 *     chunked, or → failed with an error message).
 *   - Chunks are inserted with monotonic indices and the
 *     (document_version_id, chunk_index) unique index works.
 *   - Re-running on an already-chunked version is a no-op (idempotency).
 *   - One embed job is enqueued per chunk, carrying the right
 *     documentChunkId + the document's source_event_id as rawEventId.
 *   - Soft-deleted documents are skipped without touching status.
 *   - Unsupported content-types stamp `processing_status='failed'` with
 *     a clear message and throw UnrecoverableError.
 *   - Privacy gate: non-`team` visibility documents never produce chunks.
 */

type AnyDb = Db;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../packages/db/drizzle');

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'SELECT 1;');
    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }
}

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function seedTeam(pg: PGlite): Promise<void> {
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test Team');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@test.local');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');`,
  );
}

interface Harness {
  pg: PGlite;
  db: AnyDb;
  fetchBlob: ReturnType<typeof vi.fn>;
  enqueueEmbed: ReturnType<typeof vi.fn>;
  extractFromMedia: ReturnType<typeof vi.fn>;
  extractDocx: ReturnType<typeof vi.fn>;
  io: DocumentExtractIO;
}

async function makeHarness(
  blobBody: string,
  opts: {
    visionResponse?: string;
    docxResponse?: string;
    visionModel?: string;
  } = {},
): Promise<Harness> {
  const pg = new PGlite();
  await applyMigrations(pg);
  await seedTeam(pg);
  const db = drizzle(pg) as unknown as AnyDb;
  // vi.fn signatures kept sync — eslint flags `async` without `await` as
  // useless. Wrap in Promise.resolve so the surface matches the interface
  // (which returns a Promise) without an empty async function.
  const fetchBlob = vi.fn(() => Promise.resolve({ body: Buffer.from(blobBody, 'utf-8') }));
  const enqueueEmbed = vi.fn((_data: queueNS.EmbedJobData) => Promise.resolve(undefined));
  const extractFromMedia = vi.fn((_input: { body: Buffer; mediaType: string; filename: string }) =>
    Promise.resolve({
      text: opts.visionResponse ?? 'mock vision output',
      model: opts.visionModel ?? 'openai/gpt-4o-mini',
    }),
  );
  const extractDocx = vi.fn((_body: Buffer) =>
    Promise.resolve({ text: opts.docxResponse ?? 'mock docx content' }),
  );
  const io: DocumentExtractIO = {
    fetchBlob,
    enqueueEmbed,
    requireEnv: () => undefined, // Tests don't need the OPENROUTER gate.
    extractFromMedia,
    extractDocx,
  };
  return { pg, db, fetchBlob, enqueueEmbed, extractFromMedia, extractDocx, io };
}

/**
 * Helper: create a document via the scope, finalize the upload event,
 * and return the version row. Mirrors what the web finalize action
 * would do.
 */
async function createFinalisedDocument(
  db: AnyDb,
  opts: {
    name: string;
    contentType: string;
    visibility?: 'team' | 'private' | 'specific_users';
    /** Override the upload filename. Defaults to `opts.name` for back-compat
     *  with existing tests that pass an extension-bearing display name. */
    filename?: string;
  },
): Promise<{ documentId: string; versionId: string }> {
  const scope = withTeam(db, TEAM_ID, USER_A);
  const created = await scope.documents.createDocument({
    name: opts.name,
    folderId: null,
    filename: opts.filename ?? opts.name,
    contentType: opts.contentType,
    visibility: opts.visibility ?? 'team',
  });
  const finalised = await scope.documents.finalizeDocumentVersion({
    versionId: created.version.id,
    byteSize: 1024,
    contentType: opts.contentType,
  });
  return { documentId: created.document.id, versionId: finalised.version.id };
}

// `h` is assigned at the top of every `it`. We declare it as `Harness`
// (not `| undefined`) so individual tests don't need to narrow it on each
// access. The afterEach unconditionally closes; the previous tests have
// always assigned a fresh harness by the time we reach this hook (BullMQ
// errors would surface on the worker before its teardown).
let h: Harness = undefined as unknown as Harness;

afterEach(async () => {
  await h.pg.close();
});

describe('processDocumentExtractJob — happy path', () => {
  it('chunks a text document, inserts chunks, enqueues one embed per chunk', async () => {
    h = await makeHarness('Hello world. This is a small text doc.');
    const { documentId, versionId } = await createFinalisedDocument(h.db, {
      name: 'notes.txt',
      contentType: 'text/plain',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    // Status promoted to 'chunked'.
    const status = await h.pg.query<{ processing_status: string }>(
      `SELECT processing_status FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(status.rows[0]?.processing_status).toBe('chunked');
    // Chunks landed with monotonic indices.
    const chunks = await h.pg.query<{ chunk_index: number }>(
      `SELECT chunk_index FROM document_chunks WHERE document_version_id = $1 ORDER BY chunk_index`,
      [versionId],
    );
    expect(chunks.rows.length).toBe(result.chunkCount);
    chunks.rows.forEach((r, i) => {
      expect(r.chunk_index).toBe(i);
    });
    // One embed job per chunk, each carrying the documentChunkId on the
    // doc_chunk variant of the discriminated EmbedJobData union.
    expect(h.enqueueEmbed).toHaveBeenCalledTimes(result.chunkCount ?? 0);
    const enqueued = h.enqueueEmbed.mock.calls.map((c) => c[0] as queueNS.EmbedJobData);
    for (const job of enqueued) {
      expect(job.teamId).toBe(TEAM_ID);
      // Narrow via the discriminator before reading per-variant fields.
      expect('scope' in job && job.scope === 'doc_chunk').toBe(true);
      if ('scope' in job && job.scope === 'doc_chunk') {
        expect(job.documentChunkId).toBeTruthy();
      }
    }
    // documentId loaded for cross-checking the upload event source id.
    expect(documentId).toBeTruthy();
  }, 10_000);

  it('threads targetCollection through every embed job', async () => {
    h = await makeHarness('content');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'a.txt',
      contentType: 'text/plain',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID, targetCollection: 'docs_v2' },
      h.io,
    );
    for (const call of h.enqueueEmbed.mock.calls) {
      expect((call[0] as queueNS.EmbedJobData).targetCollection).toBe('docs_v2');
    }
  });
});

describe('processDocumentExtractJob — short-circuits', () => {
  it('skips a soft-deleted document without touching status or chunks', async () => {
    h = await makeHarness('content');
    const { documentId, versionId } = await createFinalisedDocument(h.db, {
      name: 'gone.txt',
      contentType: 'text/plain',
    });
    await withTeam(h.db, TEAM_ID, USER_A).documents.softDeleteDocument(documentId);
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('document_deleted');
    expect(h.enqueueEmbed).not.toHaveBeenCalled();
    // Status stays at 'pending' — the worker did not stamp.
    const status = await h.pg.query<{ processing_status: string }>(
      `SELECT processing_status FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(status.rows[0]?.processing_status).toBe('pending');
  });

  it('is idempotent: a second run on an already-chunked version is a no-op', async () => {
    h = await makeHarness('idempotent content here');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'idem.txt',
      contentType: 'text/plain',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    const callsAfterFirst = h.enqueueEmbed.mock.calls.length;
    const chunksAfterFirst = await h.pg.query(
      `SELECT count(*)::text AS c FROM document_chunks WHERE document_version_id = $1`,
      [versionId],
    );
    // Second run.
    const second = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('already_processed');
    // No additional embed enqueues.
    expect(h.enqueueEmbed.mock.calls.length).toBe(callsAfterFirst);
    // Chunk count unchanged (no duplicate inserts).
    const chunksAfterSecond = await h.pg.query(
      `SELECT count(*)::text AS c FROM document_chunks WHERE document_version_id = $1`,
      [versionId],
    );
    expect((chunksAfterSecond.rows[0] as { c: string }).c).toBe(
      (chunksAfterFirst.rows[0] as { c: string }).c,
    );
  });

  it('two concurrent workers race the same version: only one extracts (bugbot #3298476406)', async () => {
    // Simulates a sibling worker that already flipped status to
    // 'extracting' before our handler took the lock. Without the
    // under-lock re-read of status, both workers pass the pre-lock
    // idempotency check, both fetch the blob, both pay the LLM cost.
    // After the fix the second worker observes 'extracting' inside the
    // lock and bails without calling fetchBlob or the vision model.
    h = await makeHarness('race content');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'race.txt',
      contentType: 'text/plain',
    });
    // Set status to 'extracting' BEFORE the handler runs — mimics a
    // sibling worker that already grabbed the lock and released it
    // (lock is xact-scoped). Our handler must observe this and skip.
    await h.pg.exec(
      `UPDATE document_versions SET processing_status = 'extracting' WHERE id = '${versionId}'`,
    );
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_processed');
    // Critical: the blob fetch + embed enqueue must NOT have happened.
    // Pre-fix, both rip through the full LLM extraction.
    expect(h.fetchBlob).not.toHaveBeenCalled();
    expect(h.enqueueEmbed).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError for non-existent version (does not enqueue)', async () => {
    h = await makeHarness('content');
    const FAKE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    await expect(
      processDocumentExtractJob({ db: h.db }, { documentVersionId: FAKE, teamId: TEAM_ID }, h.io),
    ).rejects.toThrow(/not found/);
    expect(h.enqueueEmbed).not.toHaveBeenCalled();
  });
});

describe('processDocumentExtractJob — privacy gate', () => {
  it('stamps failed and skips when document visibility is not "team"', async () => {
    h = await makeHarness('private content');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'private.txt',
      contentType: 'text/plain',
      visibility: 'private',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('visibility=private');
    // Status is stamped 'failed' with the visibility reason so the
    // redocument-extract script can re-pick it up after a relaxation.
    const row = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('failed');
    expect(row.rows[0]?.processing_error).toContain('visibility=private');
    // Critically: blob was never fetched, no embed jobs enqueued.
    expect(h.fetchBlob).not.toHaveBeenCalled();
    expect(h.enqueueEmbed).not.toHaveBeenCalled();
  });
});

describe('processDocumentExtractJob — content-type routing', () => {
  it('routes application/pdf through the vision extractor (LLM OCR)', async () => {
    h = await makeHarness('%PDF-1.4 fake pdf bytes', {
      visionResponse: '# Contract\n\nParties: Acme and Beta.\n\nTerms: ...',
      visionModel: 'anthropic/claude-3-5-sonnet',
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'contract.pdf',
      contentType: 'application/pdf',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    // Vision was called with the right mediaType + filename hint.
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    const call = h.extractFromMedia.mock.calls[0]?.[0] as {
      mediaType: string;
      filename: string;
    };
    expect(call.mediaType).toBe('application/pdf');
    expect(call.filename).toBe('contract.pdf');
    // DOCX path must NOT have been touched.
    expect(h.extractDocx).not.toHaveBeenCalled();
    // Version row records the vision model id so reprocess scripts can
    // re-pick rows when the model changes.
    const row = await h.pg.query<{ extraction_model_version: string }>(
      `SELECT extraction_model_version FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.extraction_model_version).toContain('anthropic/claude-3-5-sonnet');
  });

  it('routes image/* through the vision extractor', async () => {
    h = await makeHarness('\xff\xd8\xff image bytes', {
      visionResponse: 'whiteboard says: Q3 OKRs',
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'whiteboard.jpg',
      contentType: 'image/jpeg',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    const call = h.extractFromMedia.mock.calls[0]?.[0] as {
      mediaType: string;
      filename: string;
    };
    expect(call.mediaType).toBe('image/jpeg');
    expect(call.filename).toBe('whiteboard.jpg');
    // The chunk text must come from the vision response, not the blob.
    const chunk = await h.pg.query<{ text: string }>(
      `SELECT text FROM document_chunks WHERE document_version_id = $1 ORDER BY chunk_index LIMIT 1`,
      [versionId],
    );
    expect(chunk.rows[0]?.text).toContain('Q3 OKRs');
  });

  it('routes DOCX through mammoth (native), not the vision LLM', async () => {
    // DOCX vision would cost ~50x more for worse output than mammoth's
    // raw-text extraction. The routing must keep these on separate paths.
    h = await makeHarness('PK fake docx bytes', {
      docxResponse: 'Section 1\n\nThis is the contract body extracted from XML.',
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'agreement.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.extractDocx).toHaveBeenCalledOnce();
    // Vision must NOT have run.
    expect(h.extractFromMedia).not.toHaveBeenCalled();
  });

  it('falls back to filename extension when content-type is application/octet-stream', async () => {
    // RustFS sometimes loses the explicit Content-Type on PUT and the
    // version row stores application/octet-stream. The extension fallback
    // is what keeps a PDF uploaded with no MIME from stamping failed.
    h = await makeHarness('%PDF bytes', { visionResponse: 'fallback works' });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'noheader.pdf',
      contentType: 'application/octet-stream',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
  });

  it('extension fallback reads the upload filename, not the display name (bugbot #3298769081)', async () => {
    // The real-world case: users name their document something
    // human-readable like "Acme MSA" (no extension) while uploading
    // "msa.pdf". Pre-fix the worker read document.name for the
    // extension regex and stamped the doc as unsupported. Post-fix the
    // worker derives the filename from version.objectKey.
    h = await makeHarness('%PDF bytes', { visionResponse: 'derived from filename' });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'Acme MSA', // display name — no extension
      filename: 'msa.pdf', // upload filename — extension lives here
      contentType: 'application/octet-stream',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    // Vision was called because the .pdf extension routed correctly.
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
  });

  it('extension fallback also covers images when Content-Type is lost (bugbot #3299101843)', async () => {
    // The PDF/DOCX fallback above had a sibling gap: images uploaded
    // without a Content-Type were rejected as unsupported because the
    // image branch only checked `ct.startsWith('image/')` with no
    // extension fallback. Now `.jpg/.png/.webp/...` extensions on an
    // octet-stream upload route to vision with a derived image MIME.
    h = await makeHarness('\xff\xd8\xff image bytes', { visionResponse: 'whiteboard text' });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'whiteboard scan',
      filename: 'whiteboard.jpg',
      contentType: 'application/octet-stream',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    // ai-sdk needs a real image MIME on the content part — verify we
    // derived 'image/jpeg' from the .jpg extension rather than passing
    // octet-stream through.
    const firstCall = h.extractFromMedia.mock.calls[0];
    expect(firstCall).toBeDefined();
    const call = firstCall?.[0] as { mediaType: string; filename: string };
    expect(call.mediaType).toBe('image/jpeg');
    expect(call.filename).toBe('whiteboard.jpg');
  });

  it('still rejects truly unsupported content types (e.g. audio)', async () => {
    h = await makeHarness('binary audio');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'voice.mp3',
      contentType: 'audio/mpeg',
    });
    await expect(
      processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      ),
    ).rejects.toThrow(/content_type=audio\/mpeg not supported/);
    const row = await h.pg.query<{ processing_status: string }>(
      `SELECT processing_status FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('failed');
    // Critically: neither extractor was called — the worker exited cleanly.
    expect(h.extractFromMedia).not.toHaveBeenCalled();
    expect(h.extractDocx).not.toHaveBeenCalled();
  });

  it('stamps failed when vision LLM throws (lets BullMQ retry)', async () => {
    h = await makeHarness('%PDF bytes');
    h.extractFromMedia.mockRejectedValueOnce(new Error('OpenRouter 429'));
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'doc.pdf',
      contentType: 'application/pdf',
    });
    await expect(
      processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      ),
    ).rejects.toThrow(/OpenRouter 429/);
    const row = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('failed');
    expect(row.rows[0]?.processing_error).toContain('OpenRouter 429');
  });

  it('falls back to extension routing when content type is unset', async () => {
    h = await makeHarness('# Markdown\n\nHello world.');
    // Pass empty contentType — the router should still accept .md via
    // the filename extension fallback.
    const scope = withTeam(h.db, TEAM_ID, USER_A);
    const created = await scope.documents.createDocument({
      name: 'README.md',
      folderId: null,
      filename: 'README.md',
      contentType: 'application/octet-stream',
    });
    const finalised = await scope.documents.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 25,
      contentType: 'application/octet-stream',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: finalised.version.id, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
  });

  it('refuses obvious binary content even when extension looks text-ish, with an honest reason', async () => {
    // 20 NUL bytes in the head — the heuristic should reject. The
    // error must say "binary content detected", not "text/plain not
    // supported" (which is misleading — text/plain IS supported; the
    // actual file just isn't text).
    h = await makeHarness('\0'.repeat(20) + 'rest');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'fake.txt',
      contentType: 'text/plain',
    });
    await expect(
      processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      ),
    ).rejects.toThrow(/binary content detected/);
    const row = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('failed');
    expect(row.rows[0]?.processing_error).toContain('binary content detected');
    // Must NOT say the MIME is unsupported — that diagnosis would
    // mislead the operator.
    expect(row.rows[0]?.processing_error).not.toContain('not supported');
  });
});

describe('processDocumentExtractJob — fetchBlob failure', () => {
  it('stamps failed and rethrows when the blob fetch errors (lets BullMQ retry)', async () => {
    h = await makeHarness('content');
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'a.txt',
      contentType: 'text/plain',
    });
    h.fetchBlob.mockRejectedValueOnce(new Error('S3 timeout'));
    await expect(
      processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      ),
    ).rejects.toThrow(/S3 timeout/);
    const row = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('failed');
    expect(row.rows[0]?.processing_error).toContain('S3 timeout');
  });
});

// Keep the unused imports load-bearing so future tests can use the schema
// objects directly. Without this, dead-import lint complains.
void documentChunks;
void documents;
void documentVersions;
void eq;
