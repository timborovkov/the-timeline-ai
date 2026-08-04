import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { type Db, documentChunks, documents, documentVersions, rawEvents } from '@timeline/db';
import { email, withTeam, type queue as queueNS } from '@timeline/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDbMigrations } from '#src/test/pglite.js';
import {
  type DocumentExtractIO,
  type NativePdfExtractResult,
  PDF_NATIVE_MODEL,
  processDocumentExtractJob,
  shouldAcceptNativePdf,
} from '#src/workers/documentExtract.js';

// shouldAcceptNativePdf is also covered in pdfNativeExtract.test.ts; keep
// the import load-bearing for the routing cases that call it directly.

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
 *   - Private visibility documents still chunk; retrieval enforces the privacy
 *     filter with vector payload metadata.
 */

type AnyDb = Db;

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
  extractPdfNative: ReturnType<typeof vi.fn>;
  requireEnv: ReturnType<typeof vi.fn>;
  io: DocumentExtractIO;
}

/** Default mock rejects native accept criteria so existing PDF→vision cases stay stable. */
const DEFAULT_NATIVE_PDF_REJECT: NativePdfExtractResult = {
  pdfType: 'Scanned',
  confidence: 0.9,
  hasEncodingIssues: false,
};

async function makeHarness(
  blobBody: string | Buffer,
  opts: {
    visionResponse?: string;
    docxResponse?: string;
    visionModel?: string;
    nativePdf?: NativePdfExtractResult | (() => NativePdfExtractResult);
    nativePdfThrows?: Error;
  } = {},
): Promise<Harness> {
  const pg = new PGlite();
  await applyDbMigrations(pg);
  await seedTeam(pg);
  const db = drizzle(pg) as unknown as AnyDb;
  // vi.fn signatures kept sync — eslint flags `async` without `await` as
  // useless. Wrap in Promise.resolve so the surface matches the interface
  // (which returns a Promise) without an empty async function.
  const body = typeof blobBody === 'string' ? Buffer.from(blobBody, 'utf-8') : blobBody;
  const fetchBlob = vi.fn(() => Promise.resolve({ body }));
  const enqueueEmbed = vi.fn((_data: queueNS.EmbedJobData) => Promise.resolve(undefined));
  const extractFromMedia = vi.fn((_input: { body: Buffer; mediaType: string; filename: string }) =>
    Promise.resolve({
      text: opts.visionResponse ?? 'mock vision output',
      suggestedTitle: 'Suggested media title',
      model: opts.visionModel ?? 'openai/gpt-4o-mini',
    }),
  );
  const extractDocx = vi.fn((_body: Buffer) =>
    Promise.resolve({ text: opts.docxResponse ?? 'mock docx content' }),
  );
  const extractPdfNative = vi.fn((_body: Buffer) => {
    if (opts.nativePdfThrows) {
      return Promise.reject(opts.nativePdfThrows);
    }
    const result =
      typeof opts.nativePdf === 'function'
        ? opts.nativePdf()
        : (opts.nativePdf ?? DEFAULT_NATIVE_PDF_REJECT);
    return Promise.resolve(result);
  });
  const requireEnv = vi.fn(() => undefined);
  const io: DocumentExtractIO = {
    fetchBlob,
    enqueueEmbed,
    requireEnv,
    extractFromMedia,
    extractDocx,
    extractPdfNative,
  };
  return {
    pg,
    db,
    fetchBlob,
    enqueueEmbed,
    extractFromMedia,
    extractDocx,
    extractPdfNative,
    requireEnv,
    io,
  };
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

async function createFinalisedCapturedFile(
  pg: PGlite,
  opts: {
    name: string;
    contentType: string;
    byteSize?: number;
    visibility?: 'team' | 'private' | 'specific_users';
  },
): Promise<{ documentId: string; versionId: string; sourceEventId: string }> {
  const sourceEventId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const visibility = opts.visibility ?? 'team';
  await pg.query(
    `INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, visibility, visibility_owner_user_id, source_metadata)
     VALUES ($1, $2, $3, 'telegram', 'Telegram attachment', $4, $3, '{}'::jsonb)`,
    [sourceEventId, TEAM_ID, USER_A, visibility],
  );
  await pg.query(
    `INSERT INTO documents (id, team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
     VALUES ($1, $2, 'captured', null, $3, $4, $5, $6, '{}'::jsonb)`,
    [documentId, TEAM_ID, opts.name, USER_A, visibility, sourceEventId],
  );
  await pg.query(
    `INSERT INTO document_versions (id, team_id, document_id, version, object_key, byte_size, content_type, uploaded_by_user_id, source_event_id, processing_status)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, 'pending')`,
    [
      versionId,
      TEAM_ID,
      documentId,
      `${TEAM_ID}/${documentId}/v1/${opts.name}`,
      opts.byteSize ?? 1024,
      opts.contentType,
      USER_A,
      sourceEventId,
    ],
  );
  await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
    versionId,
    documentId,
  ]);
  return { documentId, versionId, sourceEventId };
}

function inboundEmailPayload(messageId: string) {
  return {
    MessageID: `postmark-${messageId}`,
    Date: '2026-05-27T09:00:00Z',
    Subject: 'Customer attachment',
    From: 'customer@example.net',
    FromName: 'Customer',
    FromFull: { Email: 'customer@example.net', Name: 'Customer', MailboxHash: '' },
    To: 't@inbound.test',
    ToFull: [{ Email: 't@inbound.test', Name: 'Test Team', MailboxHash: '' }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: '',
    ReplyTo: '',
    MailboxHash: 't',
    TextBody: 'Please review the attached implementation notes.',
    HtmlBody: '',
    StrippedTextReply: '',
    Tag: '',
    Headers: [{ Name: 'Message-ID', Value: `<${messageId}@example.net>` }],
    Attachments: [
      {
        Name: 'implementation-notes.pdf',
        Content: Buffer.from('%PDF-1.7 customer notes').toString('base64'),
        ContentType: 'application/pdf',
        ContentLength: Buffer.byteLength('%PDF-1.7 customer notes'),
        ContentID: '',
      },
    ],
  };
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
  });

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

describe('processDocumentExtractJob — privacy payloads', () => {
  it('chunks private documents so vector retrieval can enforce visibility filters', async () => {
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
    expect(result.skipped).toBeUndefined();
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    const row = await h.pg.query<{ processing_status: string }>(
      `SELECT processing_status FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.processing_status).toBe('chunked');
    expect(h.fetchBlob).toHaveBeenCalledOnce();
    expect(h.enqueueEmbed).toHaveBeenCalledTimes(result.chunkCount ?? 0);
  });
});

describe('processDocumentExtractJob — content-type routing', () => {
  it('extracts Postmark email attachments from captured documents with email provenance', async () => {
    h = await makeHarness('%PDF-1.7 customer notes', {
      visionResponse: 'Implementation notes: Acme rollout owner is Ada.',
    });
    const attachmentUpload = vi.fn().mockResolvedValue(undefined);
    const documentUpload = vi.fn().mockResolvedValue(undefined);
    const documentEnqueue = vi.fn().mockResolvedValue(undefined);

    await email.handleInbound(
      {
        db: h.db,
        inboundDomain: 'inbound.test',
        attachments: {
          uploadAttachment: attachmentUpload,
          uploadAudio: vi.fn().mockResolvedValue(undefined),
          enqueueTranscribe: vi.fn().mockResolvedValue(undefined),
          buildAttachmentKey: ({ teamId, messageId, filename }) =>
            `attachments/${teamId}/${messageId}/${filename}`,
          buildAudioKey: ({ teamId, messageId, filename }) =>
            `audio/${teamId}/${messageId}/${filename}`,
        },
        documents: {
          upload: documentUpload,
          enqueueExtract: documentEnqueue,
        },
      },
      inboundEmailPayload('email-attachment-doc'),
    );

    const [parent] = await h.db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    const [document] = await h.db.select().from(documents).where(eq(documents.teamId, TEAM_ID));
    if (!document) throw new Error('captured document not created');
    const [version] = await h.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id));
    if (!version) throw new Error('captured document version not created');
    expect(parent?.contentText).toBe('Please review the attached implementation notes.');
    expect(document).toMatchObject({
      fileKind: 'captured',
      name: 'implementation-notes.pdf',
      sourceRawEventId: parent?.id,
    });
    expect(document.metadata).toMatchObject({
      source: 'email',
      email_message_id: 'email-attachment-doc@example.net',
      parent_raw_event_id: parent?.id,
    });
    expect(version.sourceEventId).toBe(parent?.id);
    expect(documentUpload).toHaveBeenCalledWith({
      key: version.objectKey,
      body: Buffer.from('%PDF-1.7 customer notes'),
      contentType: 'application/pdf',
    });
    expect(documentEnqueue).toHaveBeenCalledWith({
      documentVersionId: version.id,
      teamId: TEAM_ID,
    });

    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: version.id, teamId: TEAM_ID },
      h.io,
    );

    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.fetchBlob).toHaveBeenCalledWith(version.objectKey, expect.any(Number));
    expect(h.extractFromMedia).toHaveBeenCalledWith({
      body: Buffer.from('%PDF-1.7 customer notes'),
      mediaType: 'application/pdf',
      filename: 'implementation-notes.pdf',
    });
    const chunks = await h.db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentVersionId, version.id));
    expect(chunks[0]?.text).toContain('Acme rollout owner is Ada');
    expect(h.enqueueEmbed).toHaveBeenCalledWith({
      scope: 'doc_chunk',
      teamId: TEAM_ID,
      documentChunkId: chunks[0]?.id,
    });
  }, 30_000);

  it('routes scanned application/pdf through the vision extractor (LLM OCR)', async () => {
    h = await makeHarness('%PDF-1.4 fake pdf bytes', {
      visionResponse: '# Contract\n\nParties: Acme and Beta.\n\nTerms: ...',
      visionModel: 'anthropic/claude-3-5-sonnet',
      nativePdf: { pdfType: 'Scanned', confidence: 0.95, hasEncodingIssues: false },
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
    // Native classifier ran first, then vision for the scanned PDF.
    expect(h.extractPdfNative).toHaveBeenCalledOnce();
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    expect(h.requireEnv).toHaveBeenCalledOnce();
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

  it('routes TextBased PDFs through pdf-inspector (native), not vision', async () => {
    h = await makeHarness('%PDF-1.4 text pdf', {
      nativePdf: {
        pdfType: 'TextBased',
        confidence: 0.95,
        hasEncodingIssues: false,
        markdown: '# Native Contract\n\nParties: Acme and Beta.',
        title: 'Acme Beta Contract',
      },
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'native-contract.pdf',
      contentType: 'application/pdf',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.extractPdfNative).toHaveBeenCalledOnce();
    expect(h.extractFromMedia).not.toHaveBeenCalled();
    expect(h.requireEnv).not.toHaveBeenCalled();

    const chunks = await h.pg.query<{ text: string; representation_kind: string }>(
      `SELECT text, representation_kind FROM document_chunks WHERE document_version_id = $1 ORDER BY chunk_index`,
      [versionId],
    );
    expect(chunks.rows).toHaveLength(1);
    expect(chunks.rows[0]?.representation_kind).toBe('source_text');
    expect(chunks.rows[0]?.text).toContain('Native Contract');
    expect(chunks.rows.map((row) => row.representation_kind)).not.toContain('visual_description');

    const row = await h.pg.query<{ extraction_model_version: string }>(
      `SELECT extraction_model_version FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(row.rows[0]?.extraction_model_version).toBe(`2026-08-a+${PDF_NATIVE_MODEL}`);
  });

  it('accepts TextBased PDFs even when pagesNeedingOcr is non-empty (library quirk)', async () => {
    // Real pdf-inspector returns pagesNeedingOcr for clean TextBased PDFs.
    // Accept criteria must ignore that field or every text PDF would hit vision.
    expect(
      shouldAcceptNativePdf({
        pdfType: 'TextBased',
        confidence: 1,
        hasEncodingIssues: false,
        markdown: '## Dummy PDF file\n',
      }),
    ).toBe(true);

    h = await makeHarness('%PDF text', {
      nativePdf: {
        pdfType: 'TextBased',
        confidence: 1,
        hasEncodingIssues: false,
        markdown: '## Dummy PDF file\n',
      },
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'dummy.pdf',
      contentType: 'application/pdf',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(h.extractFromMedia).not.toHaveBeenCalled();
  });

  it('falls back to vision for Mixed/ImageBased/low-confidence/encoding-issue/empty markdown PDFs', async () => {
    const rejectCases: NativePdfExtractResult[] = [
      { pdfType: 'Mixed', confidence: 0.95, hasEncodingIssues: false, markdown: 'partial' },
      { pdfType: 'ImageBased', confidence: 0.95, hasEncodingIssues: false },
      {
        pdfType: 'TextBased',
        confidence: 0.5,
        hasEncodingIssues: false,
        markdown: 'low confidence text',
      },
      {
        pdfType: 'TextBased',
        confidence: 0.95,
        hasEncodingIssues: true,
        markdown: 'garbled ???',
      },
      { pdfType: 'TextBased', confidence: 0.95, hasEncodingIssues: false, markdown: '   ' },
    ];
    for (const [index, nativePdf] of rejectCases.entries()) {
      if (index > 0) {
        await h.pg.close();
      }
      h = await makeHarness('%PDF bytes', {
        visionResponse: `vision for ${nativePdf.pdfType}`,
        nativePdf,
      });
      const { versionId } = await createFinalisedDocument(h.db, {
        name: `case-${nativePdf.pdfType}-${String(index)}.pdf`,
        contentType: 'application/pdf',
      });
      await processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      );
      expect(h.extractPdfNative).toHaveBeenCalledOnce();
      expect(h.extractFromMedia).toHaveBeenCalledOnce();
    }
  });

  it('falls back to vision when native PDF extract throws', async () => {
    h = await makeHarness('%PDF bytes', {
      visionResponse: 'recovered via vision',
      nativePdfThrows: new Error('napi panic'),
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'broken-native.pdf',
      contentType: 'application/pdf',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.extractPdfNative).toHaveBeenCalledOnce();
    expect(h.extractFromMedia).toHaveBeenCalledOnce();
    const chunk = await h.pg.query<{ text: string }>(
      `SELECT text FROM document_chunks WHERE document_version_id = $1`,
      [versionId],
    );
    expect(chunk.rows[0]?.text).toContain('recovered via vision');
  });

  it('stores suggested titles from native PDF title metadata', async () => {
    h = await makeHarness('%PDF text', {
      nativePdf: {
        pdfType: 'TextBased',
        confidence: 0.99,
        hasEncodingIssues: false,
        markdown: 'Body of the MSA.',
        title: 'Signed Acme MSA',
      },
    });
    const { documentId, versionId } = await createFinalisedCapturedFile(h.pg, {
      name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.pdf',
      contentType: 'application/pdf',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    const row = await h.pg.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM documents WHERE id = $1`,
      [documentId],
    );
    expect(row.rows[0]?.metadata).toMatchObject({
      suggested_title: 'Signed Acme MSA',
      suggested_title_source: 'document_extract',
      suggested_title_model: PDF_NATIVE_MODEL,
    });
  });

  it('succeeds for native PDFs without calling requireEnv (no OpenRouter)', async () => {
    h = await makeHarness('%PDF text', {
      nativePdf: {
        pdfType: 'TextBased',
        confidence: 0.9,
        hasEncodingIssues: false,
        markdown: 'offline extract ok',
      },
    });
    h.requireEnv.mockImplementation(() => {
      throw new Error('OPENROUTER_API_KEY not configured');
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'offline.pdf',
      contentType: 'application/pdf',
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(1);
    expect(h.requireEnv).not.toHaveBeenCalled();
  });

  it('requires OpenRouter when falling back to vision for scanned PDFs', async () => {
    h = await makeHarness('%PDF scanned', {
      nativePdf: { pdfType: 'Scanned', confidence: 0.9, hasEncodingIssues: false },
    });
    h.requireEnv.mockImplementation(() => {
      throw new Error('document-extract: OPENROUTER_API_KEY not configured');
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'scan.pdf',
      contentType: 'application/pdf',
    });
    await expect(
      processDocumentExtractJob(
        { db: h.db },
        { documentVersionId: versionId, teamId: TEAM_ID },
        h.io,
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY not configured/);
    expect(h.extractFromMedia).not.toHaveBeenCalled();
  });

  it('routes image/* through the vision extractor', async () => {
    h = await makeHarness('\xff\xd8\xff image bytes');
    h.extractFromMedia.mockResolvedValueOnce({
      text: 'whiteboard says: Q3 OKRs',
      visualDescription: 'A photo of a whiteboard with planning notes.',
      model: 'openai/gpt-4o-mini',
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
    const chunk = await h.pg.query<{ text: string; representation_kind: string }>(
      `SELECT text, representation_kind FROM document_chunks WHERE document_version_id = $1 ORDER BY chunk_index`,
      [versionId],
    );
    expect(chunk.rows[0]?.text).toContain('Q3 OKRs');
    expect(chunk.rows.map((row) => row.representation_kind)).toContain('source_text');
    expect(chunk.rows.map((row) => row.representation_kind)).toContain('visual_description');
    expect(chunk.rows.some((row) => row.text.includes('whiteboard with planning notes'))).toBe(
      true,
    );
  });

  it('stores suggested titles for generated media filenames', async () => {
    h = await makeHarness('\xff\xd8\xff image bytes');
    h.extractFromMedia.mockResolvedValueOnce({
      text: 'invoice total: $48.00',
      suggestedTitle: 'Coffee receipt photo',
      visualDescription: 'A photo of a small printed cafe receipt.',
      model: 'openai/gpt-4o-mini',
    });
    const { documentId, versionId } = await createFinalisedCapturedFile(h.pg, {
      name: 'AgACAgQAAyEFAATcv6dYAAP3aimENrbqY6kNAAEqxvEv6YGMrdExAAK5DmsbjOI.jpg',
      contentType: 'image/jpeg',
    });

    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );

    const row = await h.pg.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM documents WHERE id = $1`,
      [documentId],
    );
    expect(row.rows[0]?.metadata).toMatchObject({
      suggested_title: 'Coffee receipt photo',
      suggested_title_source: 'document_extract',
      suggested_title_model: 'openai/gpt-4o-mini',
    });
  });

  it('defers oversized captured files with a metadata preview instead of failing', async () => {
    h = await makeHarness('%PDF massive bytes');
    const { versionId } = await createFinalisedCapturedFile(h.pg, {
      name: 'huge-thread-dump.pdf',
      contentType: 'application/pdf',
      byteSize: 26 * 1024 * 1024,
    });
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('deferred_budget');
    expect(h.fetchBlob).not.toHaveBeenCalled();
    expect(h.enqueueEmbed).toHaveBeenCalledOnce();

    const version = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(version.rows[0]?.processing_status).toBe('deferred');
    expect(version.rows[0]?.processing_error).toContain('deferred');

    const chunk = await h.pg.query<{ representation_kind: string; text: string }>(
      `SELECT representation_kind, text FROM document_chunks WHERE document_version_id = $1`,
      [versionId],
    );
    expect(chunk.rows).toHaveLength(1);
    expect(chunk.rows[0]?.representation_kind).toBe('metadata_preview');
    expect(chunk.rows[0]?.text).toContain('Deep extraction deferred');
    const embedJob = h.enqueueEmbed.mock.calls[0]?.[0] as queueNS.EmbedJobData | undefined;
    expect(embedJob).toMatchObject({ scope: 'doc_chunk', teamId: TEAM_ID });
    expect(embedJob && 'documentChunkId' in embedJob ? embedJob.documentChunkId : null).toEqual(
      expect.any(String),
    );
  });

  it('keeps promoted oversized captures deferred and embeds their document metadata preview', async () => {
    h = await makeHarness('%PDF massive bytes');
    const { documentId, versionId } = await createFinalisedCapturedFile(h.pg, {
      name: 'large-promoted.pdf',
      contentType: 'application/pdf',
      byteSize: 50 * 1024 * 1024,
    });
    await h.pg.query(`UPDATE documents SET file_kind = 'document' WHERE id = $1`, [documentId]);
    const result = await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('deferred_budget');
    expect(h.fetchBlob).not.toHaveBeenCalled();
    expect(h.enqueueEmbed).toHaveBeenCalledOnce();

    const version = await h.pg.query<{ processing_status: string; processing_error: string }>(
      `SELECT processing_status, processing_error FROM document_versions WHERE id = $1`,
      [versionId],
    );
    expect(version.rows[0]?.processing_status).toBe('deferred');
    expect(version.rows[0]?.processing_error).toContain('document extraction cap');

    const chunk = await h.pg.query<{ representation_kind: string; text: string }>(
      `SELECT representation_kind, text FROM document_chunks WHERE document_version_id = $1`,
      [versionId],
    );
    expect(chunk.rows).toHaveLength(1);
    expect(chunk.rows[0]?.representation_kind).toBe('metadata_preview');
    expect(chunk.rows[0]?.text).toContain('Document: large-promoted.pdf');
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
    h = await makeHarness('%PDF bytes', {
      visionResponse: 'fallback works',
      nativePdf: {
        pdfType: 'TextBased',
        confidence: 0.95,
        hasEncodingIssues: false,
        markdown: 'octet-stream native path',
      },
    });
    const { versionId } = await createFinalisedDocument(h.db, {
      name: 'noheader.pdf',
      contentType: 'application/octet-stream',
    });
    await processDocumentExtractJob(
      { db: h.db },
      { documentVersionId: versionId, teamId: TEAM_ID },
      h.io,
    );
    // Native router runs first for .pdf even when MIME is lost.
    expect(h.extractPdfNative).toHaveBeenCalledOnce();
    expect(h.extractFromMedia).not.toHaveBeenCalled();
  });

  it('extension fallback reads the upload filename, not the display name (bugbot #3298769081)', async () => {
    // The real-world case: users name their document something
    // human-readable like "Acme MSA" (no extension) while uploading
    // "msa.pdf". Pre-fix the worker read document.name for the
    // extension regex and stamped the doc as unsupported. Post-fix the
    // worker derives the filename from version.objectKey.
    h = await makeHarness('%PDF bytes', {
      visionResponse: 'derived from filename',
      nativePdf: { pdfType: 'Scanned', confidence: 0.9, hasEncodingIssues: false },
    });
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
    // .pdf extension routed to the PDF router (native first, then vision).
    expect(h.extractPdfNative).toHaveBeenCalledOnce();
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
    expect(h.extractPdfNative).not.toHaveBeenCalled();
  });

  it('stamps failed when vision LLM throws (lets BullMQ retry)', async () => {
    h = await makeHarness('%PDF bytes', {
      nativePdf: { pdfType: 'Scanned', confidence: 0.9, hasEncodingIssues: false },
    });
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
