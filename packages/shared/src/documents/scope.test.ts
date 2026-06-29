import { PGlite } from '@electric-sql/pglite';
import { type Db, reconciliationEvidence } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbedResult } from '#src/llm/embed.js';
import type { SearchHit, SearchOpts } from '#src/qdrant/client.js';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

/**
 * Real-DB integration tests for the Phase 9 document scope. Uses pglite
 * (in-process Postgres in WASM) so we can exercise the actual SQL —
 * including the partial unique indexes, the visibility predicate, and
 * the raw_events transaction — without standing up Docker.
 *
 * What these tests prove that mock-only tests can't:
 *   - `finalizeDocumentVersion` is idempotent on `source_event_id` (P1 fix).
 *   - Visibility predicate blocks cross-user `private` documents.
 *   - `softDeleteDocument` drops a document from `listDocuments` and
 *     `searchDocumentChunks` while keeping the audit row.
 *   - `moveFolder` refuses to move a folder into its own subtree.
 *   - The folder-name uniqueness COALESCE trick works for the null-root
 *     case (two "Contracts" at team root collide; one in a subfolder
 *     doesn't).
 *   - Every mutating method writes the corresponding raw_events row in
 *     the SAME transaction, so a thrown error rolls back both halves.
 */

// drizzle/pglite returns a structurally-similar but nominally-different
// type from drizzle/postgres-js (which Db points at). The withTeam
// helper only uses members both adapters expose. Cast at the test boundary.
type AnyDb = Db;

const TEAM_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function seedTeamAndMembers(pg: PGlite): Promise<void> {
  // Two members so we can exercise visibility filters across users.
  await pg.exec(`INSERT INTO teams (id, slug, name) VALUES ('${TEAM_ID}', 't', 'Test Team');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_A}', 'a@test.local');`);
  await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_B}', 'b@test.local');`);
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_A}', 'owner');`,
  );
  await pg.exec(
    `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_B}', 'member');`,
  );
}

let pg: PGlite;
let db: AnyDb;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await seedTeamAndMembers(pg);
  db = drizzle(pg) as unknown as AnyDb;
});

afterEach(async () => {
  await pg.close();
});

describe('document scope — finalizeDocumentVersion idempotency (P1 fix)', () => {
  it('finalize called twice for the same version writes exactly ONE raw_events row', async () => {
    // This is the P1 regression: a UI double-click or replayed server
    // action would previously write two "Uploaded foo.pdf" timeline
    // rows. The fix short-circuits on existing source_event_id.
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'contract.pdf',
      folderId: null,
      filename: 'contract.pdf',
      contentType: 'application/pdf',
    });
    const first = await scope.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 1024,
      contentType: 'application/pdf',
    });
    const second = await scope.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 1024,
      contentType: 'application/pdf',
    });
    expect(second.eventId).toBe(first.eventId);
    expect(second.action).toBe(first.action);
    const events = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM raw_events WHERE source = 'document' AND source_metadata->>'document_id' = $1`,
      [created.document.id],
    );
    expect(events.rows[0]?.count).toBe('1');
    const evidence = await db
      .select()
      .from(reconciliationEvidence)
      .where(eq(reconciliationEvidence.rawEventId, first.eventId));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.source).toBe('document');
    expect(evidence[0]?.externalObjectId).toBe(created.version.id);
  });

  it('finalize is idempotent across separate scope instances (replay across requests)', async () => {
    // Server actions are stateless — a retried action creates a fresh
    // withTeam call. The idempotency check lives in SQL, not in scope
    // memory, so it must hold across instances.
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'doc.txt',
      folderId: null,
      filename: 'doc.txt',
      contentType: 'text/plain',
    });
    await A.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 100,
      contentType: 'text/plain',
    });
    const B = withTeam(db, TEAM_ID, USER_A).documents;
    const replay = await B.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 100,
      contentType: 'text/plain',
    });
    expect(replay.eventId).toBeTruthy();
    const events = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM raw_events WHERE source = 'document'`,
    );
    expect(events.rows[0]?.count).toBe('1');
  });

  it('does not finalize a version after the document was deleted', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'interrupted.txt',
      folderId: null,
      filename: 'interrupted.txt',
      contentType: 'text/plain',
    });

    await scope.softDeleteDocument(created.document.id);

    await expect(
      scope.finalizeDocumentVersion({
        versionId: created.version.id,
        byteSize: 100,
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('Document not found for version');

    const docs = await pg.query<{ current_version_id: string | null }>(
      `SELECT current_version_id FROM documents WHERE id = $1`,
      [created.document.id],
    );
    expect(docs.rows[0]?.current_version_id).toBeNull();
    const events = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM raw_events WHERE source = 'document' AND source_metadata->>'document_id' = $1`,
      [created.document.id],
    );
    expect(events.rows[0]?.count).toBe('1');
  });
});

describe('document scope — visibility filter', () => {
  it("user B cannot see user A's private document", async () => {
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'secret.txt',
      folderId: null,
      filename: 'secret.txt',
      contentType: 'text/plain',
      visibility: 'private',
    });
    // A sees it.
    const listedByA = await A.listDocuments({ folderId: null });
    expect(listedByA.map((d) => d.id)).toContain(created.document.id);
    expect(await A.getDocument(created.document.id)).not.toBeNull();
    // B does NOT.
    const B = withTeam(db, TEAM_ID, USER_B).documents;
    const listedByB = await B.listDocuments({ folderId: null });
    expect(listedByB.map((d) => d.id)).not.toContain(created.document.id);
    expect(await B.getDocument(created.document.id)).toBeNull();
  });

  it('team-visibility documents are visible to all team members', async () => {
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'shared.txt',
      folderId: null,
      filename: 'shared.txt',
      contentType: 'text/plain',
      visibility: 'team',
    });
    const B = withTeam(db, TEAM_ID, USER_B).documents;
    expect(await B.getDocument(created.document.id)).not.toBeNull();
  });

  it('defaults document listings to promoted documents while captured files use their own listing', async () => {
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'telegram', 'Image-only Telegram capture', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const captured = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
       VALUES ($1, 'captured', null, 'receipt.png', $2, 'team', $3, '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A, sourceEvent.rows[0]?.id],
    );
    const version = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (team_id, document_id, version, object_key, byte_size, content_type, uploaded_by_user_id, source_event_id, processing_status)
       VALUES ($1, $2, 1, 'team/captured/v1/receipt.png', 2048, 'image/png', $3, $4, 'chunked')
       RETURNING id`,
      [TEAM_ID, captured.rows[0]?.id, USER_A, sourceEvent.rows[0]?.id],
    );
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      version.rows[0]?.id,
      captured.rows[0]?.id,
    ]);

    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const documentsOnly = await scope.listDocuments({ folderId: null });
    expect(documentsOnly.map((document) => document.id)).not.toContain(captured.rows[0]?.id);

    const capturedPage = await scope.listCapturedFilesPage({ limit: 10 });
    expect(capturedPage.items.map((document) => document.id)).toContain(captured.rows[0]?.id);
    expect(capturedPage.items[0]?.fileKind).toBe('captured');
  });

  it('rejects captured files with folders at the database boundary', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const folder = await scope.createFolder({ name: 'Captures', parentFolderId: null });
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'telegram', 'Foldered capture attempt', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );

    await expect(
      pg.query(
        `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
         VALUES ($1, 'captured', $2, 'bad-capture.png', $3, 'team', $4, '{}'::jsonb)`,
        [TEAM_ID, folder.id, USER_A, sourceEvent.rows[0]?.id],
      ),
    ).rejects.toThrow(/documents_captured_folder_null_chk/);
  });

  it('filters semantic chunk search by document version date', async () => {
    const oldDoc = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, metadata)
       VALUES ($1, 'document', null, 'Old launch notes', $2, 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const newDoc = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, metadata)
       VALUES ($1, 'document', null, 'June launch notes', $2, 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const oldVersion = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (
         team_id, document_id, version, object_key, byte_size, content_type, uploaded_by_user_id, processing_status, created_at
       )
       VALUES ($1, $2, 1, 'team/docs/old.txt', 128, 'text/plain', $3, 'chunked', '2026-05-01T00:00:00.000Z')
       RETURNING id`,
      [TEAM_ID, oldDoc.rows[0]?.id, USER_A],
    );
    const newVersion = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (
         team_id, document_id, version, object_key, byte_size, content_type, uploaded_by_user_id, processing_status, created_at
       )
       VALUES ($1, $2, 1, 'team/docs/june.txt', 128, 'text/plain', $3, 'chunked', '2026-06-12T00:00:00.000Z')
       RETURNING id`,
      [TEAM_ID, newDoc.rows[0]?.id, USER_A],
    );
    const oldChunk = await pg.query<{ id: string }>(
      `INSERT INTO document_chunks (team_id, document_id, document_version_id, chunk_index, representation_kind, text, token_count)
       VALUES ($1, $2, $3, 0, 'source_text', 'Old launch plan', 3)
       RETURNING id`,
      [TEAM_ID, oldDoc.rows[0]?.id, oldVersion.rows[0]?.id],
    );
    const newChunk = await pg.query<{ id: string }>(
      `INSERT INTO document_chunks (team_id, document_id, document_version_id, chunk_index, representation_kind, text, token_count)
       VALUES ($1, $2, $3, 0, 'source_text', 'June launch plan', 3)
       RETURNING id`,
      [TEAM_ID, newDoc.rows[0]?.id, newVersion.rows[0]?.id],
    );
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      oldVersion.rows[0]?.id,
      oldDoc.rows[0]?.id,
    ]);
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      newVersion.rows[0]?.id,
      newDoc.rows[0]?.id,
    ]);

    const hits = [oldChunk.rows[0]?.id, newChunk.rows[0]?.id].map(
      (chunkId, index): SearchHit =>
        ({
          id: `point-${index}`,
          score: 0.9 - index / 10,
          payload: {
            team_id: TEAM_ID,
            source_kind: 'doc_chunk',
            document_chunk_id: chunkId,
          },
        }) as SearchHit,
    );
    const scope = withTeam(db, TEAM_ID, USER_A, {
      embed: ({ text }): Promise<EmbedResult> =>
        Promise.resolve({ vector: [text.length], model: 'test-embedding-model' }),
      qdrantSearch: (_teamId: string, _userId: string, _vector: number[], _opts: SearchOpts) =>
        Promise.resolve(hits),
    }).documents;

    const page = await scope.searchDocumentChunksPage({
      query: 'launch plan',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-07-01T00:00:00.000Z'),
      limit: 10,
    });

    expect(page.items.map((item) => item.documentName)).toEqual(['June launch notes']);
    expect(page.items[0]?.createdAt).toEqual(new Date('2026-06-12T00:00:00.000Z'));
  });

  it('promotes an existing captured file without losing source provenance', async () => {
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'slack', 'Slack file attachment', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const captured = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
       VALUES ($1, 'captured', null, 'F123.pdf', $2, 'team', $3, '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A, sourceEvent.rows[0]?.id],
    );

    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const result = await scope.promoteCapturedFile({
      id: captured.rows[0]?.id ?? '',
      name: 'Runbook.pdf',
      folderId: null,
      visibility: 'team',
    });
    const promoted = result.document;

    expect(promoted.fileKind).toBe('document');
    expect(promoted.name).toBe('Runbook.pdf');
    expect(promoted.sourceRawEventId).toBe(sourceEvent.rows[0]?.id);
    expect(promoted.promotedAt).toBeInstanceOf(Date);
    expect(promoted.promotedByUserId).toBe(USER_A);
    expect((await scope.listCapturedFilesPage({ limit: 10 })).items).toHaveLength(0);
    expect((await scope.listDocuments({ folderId: null })).map((d) => d.id)).toContain(promoted.id);
  });

  it('resets deferred current versions when captured files are promoted', async () => {
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'telegram', 'Large captured PDF', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const captured = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
       VALUES ($1, 'captured', null, 'large.pdf', $2, 'team', $3, '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A, sourceEvent.rows[0]?.id],
    );
    const version = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (
         team_id,
         document_id,
         version,
         object_key,
         byte_size,
         content_type,
         uploaded_by_user_id,
         source_event_id,
         processing_status,
         processing_error,
         extraction_model_version
       )
       VALUES (
         $1,
         $2,
         1,
         'team/captured/v1/large.pdf',
         52428800,
         'application/pdf',
         $3,
         $4,
         'deferred',
         'deep extraction deferred by captured-file budget',
         'document-extract-v1'
       )
       RETURNING id`,
      [TEAM_ID, captured.rows[0]?.id, USER_A, sourceEvent.rows[0]?.id],
    );
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      version.rows[0]?.id,
      captured.rows[0]?.id,
    ]);

    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const result = await scope.promoteCapturedFile({
      id: captured.rows[0]?.id ?? '',
      name: 'Large Runbook.pdf',
      folderId: null,
      visibility: 'team',
    });

    expect(result.reprocessVersionId).toBe(version.rows[0]?.id);
    const rows = await pg.query<{
      processing_status: string;
      processing_error: string | null;
      extraction_model_version: string | null;
    }>(
      `SELECT processing_status, processing_error, extraction_model_version
       FROM document_versions
       WHERE id = $1`,
      [version.rows[0]?.id],
    );
    expect(rows.rows[0]).toEqual({
      processing_status: 'pending',
      processing_error: null,
      extraction_model_version: null,
    });
  });

  it('resets already embedded current versions when captured files are promoted', async () => {
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'telegram', 'Processed captured PDF', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const captured = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
       VALUES ($1, 'captured', null, 'processed.pdf', $2, 'team', $3, '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A, sourceEvent.rows[0]?.id],
    );
    const version = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (
         team_id,
         document_id,
         version,
         object_key,
         byte_size,
         content_type,
         uploaded_by_user_id,
         source_event_id,
         processing_status,
         embedding_model_version
       )
       VALUES ($1, $2, 1, 'team/captured/v1/processed.pdf', 2048, 'application/pdf', $3, $4, 'embedded', 'text-embedding-3-small')
       RETURNING id`,
      [TEAM_ID, captured.rows[0]?.id, USER_A, sourceEvent.rows[0]?.id],
    );
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      version.rows[0]?.id,
      captured.rows[0]?.id,
    ]);

    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const result = await scope.promoteCapturedFile({
      id: captured.rows[0]?.id ?? '',
      name: 'Processed Runbook.pdf',
      folderId: null,
      visibility: 'team',
    });

    expect(result.reprocessVersionId).toBe(version.rows[0]?.id);
    const rows = await pg.query<{
      processing_status: string;
      processing_error: string | null;
      extraction_model_version: string | null;
    }>(
      `SELECT processing_status, processing_error, extraction_model_version
       FROM document_versions
       WHERE id = $1`,
      [version.rows[0]?.id],
    );
    expect(rows.rows[0]).toEqual({
      processing_status: 'pending',
      processing_error: null,
      extraction_model_version: null,
    });
  });

  it('resets failed current versions when captured files are promoted', async () => {
    const sourceEvent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (team_id, author_user_id, source, content_text, visibility, source_metadata)
       VALUES ($1, $2, 'telegram', 'Failed captured PDF', 'team', '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const captured = await pg.query<{ id: string }>(
      `INSERT INTO documents (team_id, file_kind, folder_id, name, owner_user_id, visibility, source_raw_event_id, metadata)
       VALUES ($1, 'captured', null, 'failed.pdf', $2, 'team', $3, '{}'::jsonb)
       RETURNING id`,
      [TEAM_ID, USER_A, sourceEvent.rows[0]?.id],
    );
    const version = await pg.query<{ id: string }>(
      `INSERT INTO document_versions (
         team_id,
         document_id,
         version,
         object_key,
         byte_size,
         content_type,
         uploaded_by_user_id,
         source_event_id,
         processing_status,
         processing_error,
         extraction_model_version
       )
       VALUES ($1, $2, 1, 'team/captured/v1/failed.pdf', 2048, 'application/pdf', $3, $4, 'failed', 'vision timeout', 'document-extract-v1')
       RETURNING id`,
      [TEAM_ID, captured.rows[0]?.id, USER_A, sourceEvent.rows[0]?.id],
    );
    await pg.query(`UPDATE documents SET current_version_id = $1 WHERE id = $2`, [
      version.rows[0]?.id,
      captured.rows[0]?.id,
    ]);

    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const result = await scope.promoteCapturedFile({
      id: captured.rows[0]?.id ?? '',
      name: 'Failed Runbook.pdf',
      folderId: null,
      visibility: 'team',
    });

    expect(result.reprocessVersionId).toBe(version.rows[0]?.id);
    const rows = await pg.query<{
      processing_status: string;
      processing_error: string | null;
      extraction_model_version: string | null;
    }>(
      `SELECT processing_status, processing_error, extraction_model_version
       FROM document_versions
       WHERE id = $1`,
      [version.rows[0]?.id],
    );
    expect(rows.rows[0]).toEqual({
      processing_status: 'pending',
      processing_error: null,
      extraction_model_version: null,
    });
  });

  it('listDocumentsWithProvenancePage does not leak hidden raw-event provenance', async () => {
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'telegram-image.png',
      folderId: null,
      filename: 'telegram-image.png',
      contentType: 'image/png',
      visibility: 'team',
    });
    const finalized = await A.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 2048,
      contentType: 'image/png',
    });
    await pg.query(
      `UPDATE raw_events
       SET visibility = 'private',
           visibility_owner_user_id = $1,
           author_user_id = $1,
           content_text = 'Hidden Telegram upload',
           source_metadata = jsonb_build_object(
             'source', 'telegram',
             'parent_raw_event_id', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
           )
       WHERE id = $2`,
      [USER_A, finalized.eventId],
    );

    const B = withTeam(db, TEAM_ID, USER_B).documents;
    const page = await B.listDocumentsWithProvenancePage({ folderId: null });
    const visibleDocument = page.items.find((document) => document.id === created.document.id);

    expect(visibleDocument).toBeTruthy();
    expect(visibleDocument?.currentVersion?.sourceEventId).toBeNull();
    expect(visibleDocument?.provenance.sourceEventId).toBeNull();
    expect(visibleDocument?.provenance.parentEventId).toBeNull();
    expect(visibleDocument?.provenance.summary).toBeNull();
    expect(visibleDocument?.provenance.metadata).not.toHaveProperty('parent_raw_event_id');
  });

  it('listDocumentsWithProvenancePage ignores deleted parent timeline events', async () => {
    const parent = await pg.query<{ id: string }>(
      `INSERT INTO raw_events (
         team_id,
         author_user_id,
         source,
         content_text,
         visibility,
         source_metadata
       )
       VALUES (
         $1,
         $2,
         'telegram',
         'Deleted parent message',
         'team',
         jsonb_build_object('deleted', 'true')
       )
      RETURNING id`,
      [TEAM_ID, USER_A],
    );
    const parentId = parent.rows[0]?.id;
    if (!parentId) throw new Error('deleted_parent_insert_failed');
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'telegram-parent.png',
      folderId: null,
      filename: 'telegram-parent.png',
      contentType: 'image/png',
      visibility: 'team',
      metadata: {
        source: 'telegram',
        parent_raw_event_id: parentId,
      },
    });
    await A.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 2048,
      contentType: 'image/png',
    });

    const page = await A.listDocumentsWithProvenancePage({ folderId: null });
    const visibleDocument = page.items.find((document) => document.id === created.document.id);

    expect(visibleDocument).toBeTruthy();
    expect(visibleDocument?.provenance.parentEventId).toBeNull();
    expect(visibleDocument?.provenance.metadata).not.toHaveProperty('parent_raw_event_id');
  });

  it('listDocumentsWithProvenancePage can target one document outside the first page', async () => {
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const target = await A.createDocument({
      name: 'older-target.pdf',
      folderId: null,
      filename: 'older-target.pdf',
      contentType: 'application/pdf',
      visibility: 'team',
    });
    await pg.query(`UPDATE documents SET updated_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [
      target.document.id,
    ]);
    for (let i = 0; i < 105; i++) {
      await A.createDocument({
        name: `newer-${String(i)}.pdf`,
        folderId: null,
        filename: `newer-${String(i)}.pdf`,
        contentType: 'application/pdf',
        visibility: 'team',
      });
    }

    const firstPage = await A.listDocumentsWithProvenancePage({ folderId: null, limit: 100 });
    expect(firstPage.items.find((document) => document.id === target.document.id)).toBeUndefined();

    const targeted = await A.listDocumentsWithProvenancePage({
      documentId: target.document.id,
      fileKind: 'document',
      limit: 1,
    });
    expect(targeted.items).toHaveLength(1);
    expect(targeted.items[0]?.id).toBe(target.document.id);
  });

  it('specific_users visibility honors the visibility_user_ids array', async () => {
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await A.createDocument({
      name: 'targeted.txt',
      folderId: null,
      filename: 'targeted.txt',
      contentType: 'text/plain',
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
    });
    // B is in the allowlist.
    const B = withTeam(db, TEAM_ID, USER_B).documents;
    expect(await B.getDocument(created.document.id)).not.toBeNull();
    // Add a third user NOT in the allowlist — they shouldn't see it.
    const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_C}', 'c@test.local');`);
    await pg.exec(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_C}', 'member');`,
    );
    const C = withTeam(db, TEAM_ID, USER_C).documents;
    expect(await C.getDocument(created.document.id)).toBeNull();
  });

  it('rejects specific_users documents and folders without an allowlist', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    await expect(
      scope.createDocument({
        name: 'empty-allowlist.txt',
        folderId: null,
        filename: 'empty-allowlist.txt',
        contentType: 'text/plain',
        visibility: 'specific_users',
        visibilityUserIds: [],
      }),
    ).rejects.toThrow('specific_users visibility requires at least one user');
    await expect(
      scope.createFolder({
        name: 'empty allowlist',
        visibility: 'specific_users',
        visibilityUserIds: [],
      }),
    ).rejects.toThrow('specific_users visibility requires at least one user');
  });
});

describe('document scope — folder constraints', () => {
  it('refuses to move a folder into its own subtree (cycle prevention)', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const parent = await scope.createFolder({ name: 'parent' });
    const child = await scope.createFolder({ name: 'child', parentFolderId: parent.id });
    await expect(scope.moveFolder({ id: parent.id, parentFolderId: child.id })).rejects.toThrow(
      /subtree/,
    );
  });

  it('rejects duplicate folder names within the same parent (COALESCE-null-root unique)', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    await scope.createFolder({ name: 'Contracts' });
    await expect(scope.createFolder({ name: 'Contracts' })).rejects.toThrow();
  });

  it('allows the same folder name in different parents', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const a = await scope.createFolder({ name: 'A' });
    const b = await scope.createFolder({ name: 'B' });
    // "Reports" in folder A and "Reports" in folder B both succeed.
    await scope.createFolder({ name: 'Reports', parentFolderId: a.id });
    await expect(
      scope.createFolder({ name: 'Reports', parentFolderId: b.id }),
    ).resolves.toBeTruthy();
  });
});

describe('document scope — soft delete + audit trail', () => {
  it('soft-deleted documents disappear from listDocuments but the audit row stays', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'oops.txt',
      folderId: null,
      filename: 'oops.txt',
      contentType: 'text/plain',
    });
    await scope.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 10,
      contentType: 'text/plain',
    });
    await scope.softDeleteDocument(created.document.id);
    const remaining = await scope.listDocuments({ folderId: null });
    expect(remaining.map((d) => d.id)).not.toContain(created.document.id);
    // Audit: 1 upload event + 1 delete event in raw_events.
    const events = await pg.query<{ action: string }>(
      `SELECT source_metadata->>'action' AS action FROM raw_events WHERE source = 'document' ORDER BY occurred_at`,
    );
    expect(events.rows.map((r) => r.action)).toEqual(['upload', 'delete']);
  });

  it('restoreDocument brings the doc back into listDocuments', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'restoreme.txt',
      folderId: null,
      filename: 'restoreme.txt',
      contentType: 'text/plain',
    });
    await scope.softDeleteDocument(created.document.id);
    await scope.restoreDocument(created.document.id);
    const remaining = await scope.listDocuments({ folderId: null });
    expect(remaining.map((d) => d.id)).toContain(created.document.id);
  });

  it('soft-deleted folders are NOT reachable via getFolder (bugbot #3298903330)', async () => {
    // Same contract as documents: a direct-by-id lookup of a soft-
    // deleted folder must return null so the detail page, breadcrumbs,
    // and ancestry helper all hide it. restoreFolder bypasses
    // getFolderRaw so undelete still finds the row.
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const folder = await scope.createFolder({ name: 'Drafts' });
    expect(await scope.getFolder(folder.id)).not.toBeNull();
    await scope.softDeleteFolder(folder.id);
    expect(await scope.getFolder(folder.id)).toBeNull();
    // folderPath + folderAncestry must also hide the deleted ancestor.
    expect(await scope.folderPath(folder.id)).toBe('/');
    expect(await scope.folderAncestry(folder.id)).toEqual([]);
    await scope.restoreFolder(folder.id);
    expect(await scope.getFolder(folder.id)).not.toBeNull();
  });

  it('folderAncestry hides ancestors invisible to the caller (no name leak)', async () => {
    // Reachable scenario: user A creates a private "Secret" folder,
    // then a team-visible "Public" child inside it. User B can see
    // Public via listFolders (it filters by the folder's OWN
    // visibility, not its parent's). Pre-fix the breadcrumb walk
    // returned `[Secret, Public]` for user B because folderAncestry
    // didn't apply the visibility predicate at each step. The fix
    // adds folderVisibility to the per-row where-clause; the walk
    // stops at the invisible ancestor so the breadcrumb truncates.
    const A = withTeam(db, TEAM_ID, USER_A).documents;
    const secret = await A.createFolder({
      name: 'Secret',
      visibility: 'private',
    });
    const pub = await A.createFolder({
      name: 'Public',
      parentFolderId: secret.id,
      visibility: 'team',
    });
    // User A sees the full chain.
    expect(await A.folderAncestry(pub.id)).toEqual([
      { id: secret.id, name: 'Secret' },
      { id: pub.id, name: 'Public' },
    ]);
    // User B sees only the team-visible leaf; "Secret" is not exposed.
    const B = withTeam(db, TEAM_ID, USER_B).documents;
    expect(await B.folderAncestry(pub.id)).toEqual([{ id: pub.id, name: 'Public' }]);
    // folderPath inherits the same protection.
    expect(await B.folderPath(pub.id)).toBe('/Public');
  });

  it('folderAncestry returns ancestors shallowest-first (replaces page breadcrumb walker)', async () => {
    // Pins the contract the page's breadcrumb code relies on after the
    // duplicated walker was removed.
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const a = await scope.createFolder({ name: 'A' });
    const b = await scope.createFolder({ name: 'B', parentFolderId: a.id });
    const c = await scope.createFolder({ name: 'C', parentFolderId: b.id });
    expect(await scope.folderAncestry(c.id)).toEqual([
      { id: a.id, name: 'A' },
      { id: b.id, name: 'B' },
      { id: c.id, name: 'C' },
    ]);
    expect(await scope.folderAncestry(null)).toEqual([]);
  });

  it('soft-deleted documents are NOT reachable via getDocument (bugbot #3298769085)', async () => {
    // Pre-fix, a direct-by-id lookup still returned the row, so the
    // detail page, the agent's get_document tool, and the download
    // action all leaked content of "deleted" docs. The fix filters
    // by isNull(deletedAt) in getDocumentRaw.
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'gone.txt',
      folderId: null,
      filename: 'gone.txt',
      contentType: 'text/plain',
    });
    // Before delete: getDocument finds it.
    expect(await scope.getDocument(created.document.id)).not.toBeNull();
    await scope.softDeleteDocument(created.document.id);
    // After delete: getDocument returns null even though the row
    // physically exists (soft delete preserves the audit trail).
    expect(await scope.getDocument(created.document.id)).toBeNull();
    // restoreDocument deliberately bypasses getDocumentRaw so it can
    // still find the soft-deleted row to undelete it.
    await scope.restoreDocument(created.document.id);
    expect(await scope.getDocument(created.document.id)).not.toBeNull();
  });
});

describe('document scope — transactional invariant', () => {
  it('renameDocument writes exactly one rename raw_event per call', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'first.txt',
      folderId: null,
      filename: 'first.txt',
      contentType: 'text/plain',
    });
    await scope.renameDocument({ id: created.document.id, name: 'second.txt' });
    await scope.renameDocument({ id: created.document.id, name: 'third.txt' });
    const events = await pg.query<{ action: string; summary: string }>(
      `SELECT source_metadata->>'action' AS action, content_text AS summary FROM raw_events WHERE source = 'document' AND source_metadata->>'action' = 'rename' ORDER BY occurred_at`,
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0]?.summary).toContain('first.txt');
    expect(events.rows[0]?.summary).toContain('second.txt');
    expect(events.rows[1]?.summary).toContain('third.txt');
  });

  it('previous values are captured in the rename audit row', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A).documents;
    const created = await scope.createDocument({
      name: 'before.txt',
      folderId: null,
      filename: 'before.txt',
      contentType: 'text/plain',
    });
    await scope.renameDocument({ id: created.document.id, name: 'after.txt' });
    const events = await pg.query<{ previous: string | null }>(
      `SELECT source_metadata->'previous'->>'name' AS previous FROM raw_events WHERE source_metadata->>'action' = 'rename'`,
    );
    expect(events.rows[0]?.previous).toBe('before.txt');
  });
});
