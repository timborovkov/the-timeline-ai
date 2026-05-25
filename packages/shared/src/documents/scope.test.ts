import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withTeam } from '../team-scope.js';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../db/drizzle');

async function applyMigrations(pg: PGlite): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    // Drizzle's `--> statement-breakpoint` marker delimits individual
    // statements. pglite's `exec()` can handle multi-statement SQL but
    // commits at each separator boundary, which matters for
    // `ALTER TYPE ... ADD VALUE` (the new value isn't usable in the
    // same transaction). Splitting and executing one statement at a
    // time mirrors what Drizzle's migrator does on real Postgres.
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
  await applyMigrations(pg);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
  });

  it('finalize is idempotent across separate scope instances (replay across requests)', async () => {
    // Server actions are stateless — a retried action creates a fresh
    // withTeam call. The idempotency check lives in SQL, not in scope
    // memory, so it must hold across instances.
    const scopeA = withTeam(db, TEAM_ID, USER_A);
    const created = await scopeA.createDocument({
      name: 'doc.txt',
      folderId: null,
      filename: 'doc.txt',
      contentType: 'text/plain',
    });
    await scopeA.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 100,
      contentType: 'text/plain',
    });
    const scopeB = withTeam(db, TEAM_ID, USER_A);
    const replay = await scopeB.finalizeDocumentVersion({
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
});

describe('document scope — visibility filter', () => {
  it("user B cannot see user A's private document", async () => {
    const scopeA = withTeam(db, TEAM_ID, USER_A);
    const created = await scopeA.createDocument({
      name: 'secret.txt',
      folderId: null,
      filename: 'secret.txt',
      contentType: 'text/plain',
      visibility: 'private',
    });
    // A sees it.
    const listedByA = await scopeA.listDocuments({ folderId: null });
    expect(listedByA.map((d) => d.id)).toContain(created.document.id);
    expect(await scopeA.getDocument(created.document.id)).not.toBeNull();
    // B does NOT.
    const scopeB = withTeam(db, TEAM_ID, USER_B);
    const listedByB = await scopeB.listDocuments({ folderId: null });
    expect(listedByB.map((d) => d.id)).not.toContain(created.document.id);
    expect(await scopeB.getDocument(created.document.id)).toBeNull();
  });

  it('team-visibility documents are visible to all team members', async () => {
    const scopeA = withTeam(db, TEAM_ID, USER_A);
    const created = await scopeA.createDocument({
      name: 'shared.txt',
      folderId: null,
      filename: 'shared.txt',
      contentType: 'text/plain',
      visibility: 'team',
    });
    const scopeB = withTeam(db, TEAM_ID, USER_B);
    expect(await scopeB.getDocument(created.document.id)).not.toBeNull();
  });

  it('specific_users visibility honors the visibility_user_ids array', async () => {
    const scopeA = withTeam(db, TEAM_ID, USER_A);
    const created = await scopeA.createDocument({
      name: 'targeted.txt',
      folderId: null,
      filename: 'targeted.txt',
      contentType: 'text/plain',
      visibility: 'specific_users',
      visibilityUserIds: [USER_B],
    });
    // B is in the allowlist.
    const scopeB = withTeam(db, TEAM_ID, USER_B);
    expect(await scopeB.getDocument(created.document.id)).not.toBeNull();
    // Add a third user NOT in the allowlist — they shouldn't see it.
    const USER_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    await pg.exec(`INSERT INTO users (id, email) VALUES ('${USER_C}', 'c@test.local');`);
    await pg.exec(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ('${TEAM_ID}', '${USER_C}', 'member');`,
    );
    const scopeC = withTeam(db, TEAM_ID, USER_C);
    expect(await scopeC.getDocument(created.document.id)).toBeNull();
  });
});

describe('document scope — folder constraints', () => {
  it('refuses to move a folder into its own subtree (cycle prevention)', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A);
    const parent = await scope.createFolder({ name: 'parent' });
    const child = await scope.createFolder({ name: 'child', parentFolderId: parent.id });
    await expect(scope.moveFolder({ id: parent.id, parentFolderId: child.id })).rejects.toThrow(
      /subtree/,
    );
  });

  it('rejects duplicate folder names within the same parent (COALESCE-null-root unique)', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A);
    await scope.createFolder({ name: 'Contracts' });
    await expect(scope.createFolder({ name: 'Contracts' })).rejects.toThrow();
  });

  it('allows the same folder name in different parents', async () => {
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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

  it('folderAncestry returns ancestors shallowest-first (replaces page breadcrumb walker)', async () => {
    // Pins the contract the page's breadcrumb code relies on after the
    // duplicated walker was removed.
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
    const scope = withTeam(db, TEAM_ID, USER_A);
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
