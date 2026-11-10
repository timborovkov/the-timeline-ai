// Real SQL guards tenant isolation, immutable snapshot retries and stale completion.
// Only object storage transport is faked here; the opt-in live E2E verifies real S3 bytes.
import { PGlite } from '@electric-sql/pglite';
import { type Db, documents, documentVersions } from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { createOnboardingScope } from '#src/onboarding/index.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const storage = vi.hoisted(() => ({ put: vi.fn(() => Promise.resolve()) }));
await vi.mock(
  import.meta.resolve('#src/s3/objects.js'),
  () => ({ putObject: storage.put }),
  () => import('#src/s3/objects.js'),
);
await vi.mock(
  import.meta.resolve('#src/s3/client.js'),
  () => ({ getS3Client: () => ({}), getDocumentsBucket: () => 'test' }),
  () => import('#src/s3/client.js'),
);
const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCAN = '33333333-3333-4333-8333-333333333333';
const NEW_SCAN = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';
const page = {
  url: 'https://example.com/',
  title: 'Example',
  text: '# Example\n\nPublic company description.'.repeat(6),
};
let pg: PGlite;
let db: Db;
const scope = (teamId = TEAM) =>
  createOnboardingScope({
    db,
    teamId,
    userId: USER,
    ensureMember: () => Promise.resolve('owner' as const),
    getSuggestion: () => Promise.resolve(null),
  });
beforeEach(async () => {
  storage.put.mockClear();
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${TEAM}','one','One'),('${OTHER}','two','Two'); INSERT INTO users(id,email) VALUES ('${USER}','owner@example.test'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner'),('${OTHER}','${USER}','owner'); INSERT INTO team_billing_accounts(team_id,plan_id,billing_state,shadow_billing) VALUES ('${TEAM}','payg','payg_active',true); INSERT INTO raw_events(id,team_id,author_user_id,source,content_text,source_metadata) VALUES ('${EVENT}','${TEAM}','${USER}','web','Page','{"websiteScanId":"${SCAN}"}');`,
  );
}, 60_000);
afterEach(async () => {
  await pg.close();
});
describe('website snapshots', () => {
  it('persists crawl identity and immutable pages without exposing another team', async () => {
    await scope().saveWebsiteCrawlId({
      scanId: SCAN,
      url: page.url,
      websiteSubject: 'other_company',
      crawlId: 'crawl-1',
    });
    expect(await scope().getWebsiteCrawlId(SCAN)).toBe('crawl-1');
    await scope().saveWebsiteScanPages({
      scanId: SCAN,
      url: page.url,
      websiteSubject: 'other_company',
      pages: [page],
    });
    await scope().saveWebsiteScanPages({
      scanId: SCAN,
      url: page.url,
      websiteSubject: 'other_company',
      pages: [{ ...page, text: 'changed' }],
    });
    expect(await scope().getWebsiteScanPages(SCAN)).toEqual([page]);
    expect(await scope(OTHER).getWebsiteScanPages(SCAN)).toBeNull();
    expect(await scope(OTHER).getWebsiteCrawlId(SCAN)).toBeNull();
  });
  it('retries the original snapshot without overwriting a newer promoted document version', async () => {
    await scope().saveWebsiteScanPages({
      scanId: SCAN,
      url: page.url,
      websiteSubject: 'own_team',
      pages: [page],
    });
    const saved = await scope().saveWebsitePageDocument({ scanId: SCAN, eventId: EVENT, page });
    const [original] = await db.select().from(documentVersions);
    const [newVersion] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: saved.documentId,
        version: 2,
        objectKey: 'newer.md',
        contentType: 'text/markdown',
        sourceEventId: EVENT,
      })
      .returning();
    if (!original || !newVersion) throw new Error('Expected saved document versions');
    await db
      .update(documents)
      .set({ fileKind: 'document', currentVersionId: newVersion.id })
      .where(eq(documents.id, saved.documentId));
    await scope().saveWebsitePageDocument({ scanId: SCAN, eventId: EVENT, page });
    expect((await db.select().from(documents))[0]?.currentVersionId).toBe(newVersion.id);
    expect(await db.select().from(documentVersions)).toHaveLength(2);
    expect(storage.put).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ key: original.objectKey, body: Buffer.from(page.text) }),
    );
  });
  it('rechecks chunk capacity after storage upload and admits retries idempotently', async () => {
    await pg.exec(
      `UPDATE team_billing_accounts SET plan_id='free', billing_state='free' WHERE team_id='${TEAM}'`,
    );
    await scope().saveWebsiteScanPages({
      scanId: SCAN,
      url: page.url,
      websiteSubject: 'own_team',
      pages: [page],
    });
    const [otherDoc] = await db
      .insert(documents)
      .values({ teamId: TEAM, name: 'Other' })
      .returning();
    if (!otherDoc) throw new Error('Expected another document');
    const [otherVersion] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: otherDoc.id,
        version: 1,
        objectKey: 'other.md',
        contentType: 'text/markdown',
      })
      .returning();
    if (!otherVersion) throw new Error('Expected another version');
    storage.put.mockImplementationOnce(async () => {
      // Another extraction fills the allowance while the website upload is in flight.
      await pg.exec(`INSERT INTO document_chunks(team_id, document_id, document_version_id, chunk_index, text, token_count)
        SELECT '${TEAM}', '${otherDoc.id}', '${otherVersion.id}', n, 'other', 1 FROM generate_series(1,20000) n`);
    });
    const input = { scanId: SCAN, eventId: EVENT, page };
    await expect(scope().saveWebsitePageDocument(input)).rejects.toThrow('Indexed chunk limit');
    const pending = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.sourceEventId, EVENT));
    expect(pending[0]?.processingStatus).toBe('pending');
    // Leave exactly one slot, then verify a completed retry consumes no extra slot.
    await pg.exec(
      `DELETE FROM document_chunks WHERE document_version_id='${otherVersion.id}' AND chunk_index=20000`,
    );
    await scope().saveWebsitePageDocument(input);
    await scope().saveWebsitePageDocument(input);
    const counts = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM document_chunks WHERE team_id='${TEAM}'`,
    );
    expect(counts.rows[0]?.n).toBe(20000);
  });

  it('ignores success and failure from an old selection of the same URL', async () => {
    await scope().selectStarterPath('website', {
      websiteUrl: page.url,
      websiteScanId: SCAN,
      websiteSubject: 'own_team',
    });
    await scope().selectStarterPath('website', {
      websiteUrl: page.url,
      websiteScanId: NEW_SCAN,
      websiteSubject: 'other_company',
    });
    await scope().markScanFailed('unreachable', SCAN);
    await scope().attachCapture({
      eventId: EVENT,
      landed: true,
      requireStarterPath: 'website',
      websiteScanId: SCAN,
    });
    const current = await scope().getFirstRun();
    expect(current?.phase).toBe('processing');
    expect(current?.captureEventId).toBeNull();
    expect(current?.websiteSubject).toBe('other_company');
  });
});
