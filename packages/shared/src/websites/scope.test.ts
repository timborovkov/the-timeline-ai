// Real SQL constraints protect team isolation, scan idempotency, and distributed crawl admission.
import { PGlite } from '@electric-sql/pglite';
import {
  type Db,
  rawEvents,
  documents,
  documentVersions,
  documentChunks,
  websitePages,
  websiteRuns,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { beforeEach, afterEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';
import { completeWebsiteChunk } from '#src/websites/completion.js';
import { obsoleteWebsiteEventIds } from '#src/websites/retrieval.js';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture');
  return value;
}
const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: PGlite;
let db: Db;
beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${TEAM}','websites','Websites'),('${OTHER}','other-websites','Other'); INSERT INTO users(id,email) VALUES ('${OWNER}','owner@example.test'),('${MEMBER}','member@example.test'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${OWNER}','owner'),('${TEAM}','${MEMBER}','member'),('${OTHER}','${OWNER}','owner');`,
  );
});
afterEach(async () => {
  await pg.close();
});
async function source() {
  return withTeam(db, TEAM, MEMBER).websites.add({
    url: 'https://example.com',
    subject: 'other_company',
    permissionConfirmed: true,
  });
}
describe('persistent website scope', () => {
  it('allows member scans but confines schedule management to admins and reads to the source team', async () => {
    const website = await source();
    await expect(
      withTeam(db, TEAM, MEMBER).websites.configure(website.id, { paused: true }),
    ).rejects.toThrow('admin');
    await expect(withTeam(db, OTHER, OWNER).websites.get(website.id)).rejects.toThrow('not found');
    await withTeam(db, TEAM, OWNER).websites.configure(website.id, { paused: true });
    await expect(
      withTeam(db, TEAM, MEMBER).websites.admit({
        websiteId: website.id,
        idempotencyKey: 'one',
        trigger: 'manual',
      }),
    ).rejects.toThrow('paused');
  });
  it('returns one run for a retry and blocks another active scan', async () => {
    const website = await source();
    const scope = withTeam(db, TEAM, MEMBER).websites;
    const first = await scope.admit({
      websiteId: website.id,
      idempotencyKey: 'one',
      trigger: 'manual',
    });
    const again = await scope.admit({
      websiteId: website.id,
      idempotencyKey: 'one',
      trigger: 'manual',
    });
    expect(again.id).toBe(first.id);
    expect(first.unitsPerPage).toBe(20);
    await expect(
      scope.admit({ websiteId: website.id, idempotencyKey: 'two', trigger: 'manual' }),
    ).rejects.toThrow();
    expect((await scope.history(website.id)).length).toBe(1);
  });
  it('does not grant a second provider lease for the same run', async () => {
    const website = await source();
    const scope = withTeam(db, TEAM, MEMBER).websites;
    const run = await scope.admit({
      websiteId: website.id,
      idempotencyKey: 'one',
      trigger: 'manual',
    });
    expect(await scope.claimProvider(run.id)).toBe(true);
    expect(await scope.claimProvider(run.id)).toBe(false);
  });
  it('normalises duplicate URLs and requires permission', async () => {
    await source();
    await expect(
      withTeam(db, TEAM, MEMBER).websites.add({
        url: 'https://example.com:443/#section',
        subject: 'own_team',
        permissionConfirmed: true,
      }),
    ).rejects.toThrow('already exists');
    await expect(
      withTeam(db, TEAM, MEMBER).websites.add({
        url: 'https://other.example',
        subject: 'own_team',
        permissionConfirmed: false,
      }),
    ).rejects.toThrow('permission');
  });
});

// Versions remain historical evidence while current answers wait for all new chunks.
it.each([null, 'provider_failed'])(
  'promotes ready versions without discarding provider failure %s',
  async (failureReason) => {
    const website = await source();
    const scope = withTeam(db, TEAM, MEMBER).websites;
    const run = await scope.admit({
      websiteId: website.id,
      idempotencyKey: 'version-run',
      trigger: 'manual',
    });
    const [oldEvent] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM,
        authorUserId: MEMBER,
        source: 'web',
        sourceMetadata: {
          websiteId: website.id,
          websiteScanId: run.id,
          pageUrl: website.url,
          websiteContentHash: 'old',
        },
      })
      .returning();
    const [newEvent] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM,
        authorUserId: MEMBER,
        source: 'web',
        sourceMetadata: {
          websiteId: website.id,
          websiteScanId: run.id,
          pageUrl: website.url,
          websiteContentHash: 'new',
        },
      })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        teamId: TEAM,
        name: 'Page.md',
        fileKind: 'captured',
        ownerUserId: MEMBER,
        sourceRawEventId: must(oldEvent).id,
      })
      .returning();
    const [oldVersion] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: must(document).id,
        version: 1,
        objectKey: 'old',
        sourceEventId: must(oldEvent).id,
        processingStatus: 'embedded',
      })
      .returning();
    const [newVersion] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: must(document).id,
        version: 2,
        objectKey: 'new',
        sourceEventId: must(newEvent).id,
        processingStatus: 'chunked',
      })
      .returning();
    await db.insert(websitePages).values({
      teamId: TEAM,
      websiteId: website.id,
      url: website.url,
      documentId: must(document).id,
      currentEventId: must(oldEvent).id,
      currentVersionId: must(oldVersion).id,
      contentHash: 'old',
    });
    const chunks = await db
      .insert(documentChunks)
      .values(
        [0, 1].map((index) => ({
          teamId: TEAM,
          documentId: must(document).id,
          documentVersionId: must(newVersion).id,
          chunkIndex: index,
          text: 'Page content',
          tokenCount: 3,
        })),
      )
      .returning();
    await scope.updateRun(run.id, { status: 'processing', changedCount: 1, failureReason });
    await completeWebsiteChunk(db, TEAM, must(chunks[0]).id, 'test-model');
    expect((await scope.page(website.id, website.url))?.currentEventId).toBe(must(oldEvent).id);
    expect(await obsoleteWebsiteEventIds(db, TEAM)).toContain(must(newEvent).id);
    if (failureReason) await scope.updateRun(run.id, { handoffAt: new Date() });
    await completeWebsiteChunk(db, TEAM, must(chunks[1]).id, 'test-model');
    expect((await scope.page(website.id, website.url))?.currentEventId).toBe(must(newEvent).id);
    expect((await scope.getRun(run.id)).status).toBe(failureReason ? 'partial' : 'processing');
    expect(await obsoleteWebsiteEventIds(db, TEAM)).toContain(must(oldEvent).id);
    expect(await obsoleteWebsiteEventIds(db, OTHER)).toEqual([]);
    await scope.updateRun(run.id, { handoffAt: new Date() });
    await completeWebsiteChunk(db, TEAM, must(chunks[1]).id, 'test-model');
    // Replayed completion reconciles the run even when this version is already current.
    expect((await scope.getRun(run.id)).status).toBe(failureReason ? 'partial' : 'completed');
    const { tickWebsiteSchedules } = await import('#src/websites/scheduler.js');
    await tickWebsiteSchedules(db);
    expect((await scope.getRun(run.id)).status).toBe(failureReason ? 'partial' : 'completed');
    expect((await scope.getRun(run.id)).failureReason).toBe(failureReason);
    // A duplicate embedding callback must preserve the current version and immutable old event.
    expect(
      (
        await db
          .select()
          .from(rawEvents)
          .where(eq(rawEvents.id, must(oldEvent).id))
      )[0]?.sourceMetadata,
    ).toEqual({
      websiteId: website.id,
      websiteScanId: run.id,
      pageUrl: website.url,
      websiteContentHash: 'old',
    });
    expect(
      (await db.select().from(websiteRuns).where(eq(websiteRuns.id, run.id)))[0]?.changedCount,
    ).toBe(1);
  },
);

it('keeps global hostname occupancy after a worker lease expires', async () => {
  const website = await source();
  const scope = withTeam(db, TEAM, MEMBER).websites;
  const run = await scope.admit({
    websiteId: website.id,
    idempotencyKey: 'busy',
    trigger: 'manual',
  });
  expect(await scope.claimProvider(run.id)).toBe(true);
  await scope.updateRun(run.id, { leaseUntil: new Date(0) });
  const other = withTeam(db, OTHER, OWNER).websites;
  const second = await other.add({
    url: website.url,
    subject: 'other_company',
    permissionConfirmed: true,
  });
  const secondRun = await other.admit({
    websiteId: second.id,
    idempotencyKey: 'busy',
    trigger: 'manual',
  });
  expect(await other.claimProvider(secondRun.id)).toBe(false);
});

it('settles captured weighted pages exactly once after requester removal', async () => {
  const { websiteSources, billingUsageLedger, teamMembers } = await import('@timeline/db');
  const { settleCapturedWebsiteRun } = await import('#src/websites/recovery.js');
  const website = await source();
  const scope = withTeam(db, TEAM, MEMBER);
  const run = await scope.websites.admit({
    websiteId: website.id,
    idempotencyKey: 'settlement',
    trigger: 'manual',
  });
  await scope.billing.reserve({
    operationId: `website-scan:${run.id}`,
    meterId: 'accepted_sources',
    reservedNativeUnits: 100,
    reservedChargeCents: 5,
    ttlMs: 1_800_000,
  });
  await db.insert(websiteSources).values({
    id: run.id,
    teamId: TEAM,
    url: website.url,
    websiteSubject: 'other_company',
    pages: [{ url: website.url, title: 'Public page', text: 'Persisted content' }],
  });
  await scope.websites.updateRun(run.id, { estimatedProviderCostEur: 0.00415 });
  await db.update(teamMembers).set({ removedAt: new Date() }).where(eq(teamMembers.userId, MEMBER));
  await settleCapturedWebsiteRun(db, TEAM, run.id);
  await settleCapturedWebsiteRun(db, TEAM, run.id);
  const ledger = await db
    .select()
    .from(billingUsageLedger)
    .where(eq(billingUsageLedger.operationId, `website-scan:${run.id}`));
  expect(ledger).toHaveLength(1);
  expect(Number(must(ledger[0]).nativeUnits)).toBe(20);
});

it('does not grant website permission to old keys and rechecks revocation', async () => {
  const { mcpOutboundKeys } = await import('@timeline/db');
  const { authorizeWebsitePrincipal } = await import('#src/websites/authorization.js');
  const [key] = await db
    .insert(mcpOutboundKeys)
    .values({
      teamId: TEAM,
      createdByUserId: OWNER,
      name: 'Test',
      keyHash: 'test-hash',
      keyPrefix: 'test',
      scopes: ['read'],
    })
    .returning();
  const principal = {
    authType: 'api_key' as const,
    teamId: TEAM,
    userId: '00000000-0000-0000-0000-000000000000',
    keyId: must(key).id,
    clientId: must(key).id,
    scopes: ['read', 'websites:scan'],
  };
  await expect(authorizeWebsitePrincipal(db, principal, 'websites:scan')).rejects.toThrow();
  await db
    .update(mcpOutboundKeys)
    .set({ scopes: ['read', 'websites:scan'] })
    .where(eq(mcpOutboundKeys.id, must(key).id));
  await authorizeWebsitePrincipal(db, principal, 'websites:scan');
  await db
    .update(mcpOutboundKeys)
    .set({ revokedAt: new Date() })
    .where(eq(mcpOutboundKeys.id, must(key).id));
  await expect(authorizeWebsitePrincipal(db, principal, 'websites:scan')).rejects.toThrow(
    'revoked',
  );
});

it('adopts a pending legacy job after populated migration without changing snapshot identities', async () => {
  const { websiteSources, websites } = await import('@timeline/db');
  const { readFileSync } = await import('node:fs');
  const oldId = '33333333-3333-4333-8333-333333333333';
  const pendingId = '44444444-4444-4444-8444-444444444444';
  const url = 'https://example.com/';
  await db.insert(websiteSources).values([
    {
      id: oldId,
      teamId: TEAM,
      url,
      websiteSubject: 'own_team',
      pages: [{ url, title: 'Old', text: 'Old page' }],
      createdAt: new Date('2026-01-01'),
    },
    {
      id: pendingId,
      teamId: TEAM,
      url,
      websiteSubject: 'own_team',
      crawlId: 'provider-existing',
      createdAt: new Date('2026-01-02'),
    },
  ]);
  async function capture(scanId: string, date: Date) {
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM,
        authorUserId: MEMBER,
        source: 'web',
        createdAt: date,
        sourceMetadata: { websiteScanId: scanId, pageUrl: url },
      })
      .returning();
    const [doc] = await db
      .insert(documents)
      .values({
        teamId: TEAM,
        name: 'Legacy.md',
        fileKind: 'captured',
        ownerUserId: MEMBER,
        sourceRawEventId: must(event).id,
      })
      .returning();
    const [version] = await db
      .insert(documentVersions)
      .values({
        teamId: TEAM,
        documentId: must(doc).id,
        version: 1,
        objectKey: scanId,
        sourceEventId: must(event).id,
        processingStatus: 'embedded',
      })
      .returning();
    await db
      .update(documents)
      .set({ currentVersionId: must(version).id })
      .where(eq(documents.id, must(doc).id));
    return { event: must(event), doc: must(doc), version: must(version) };
  }
  const old = await capture(oldId, new Date('2026-01-01'));
  await pg.exec(
    'DROP TABLE website_notifications, website_pages, website_runs, websites CASCADE; ALTER TABLE document_chunks DROP COLUMN website_embedded_at;',
  );
  await pg.exec(
    readFileSync(
      new URL('../../../db/drizzle/0103_persistent_websites.sql', import.meta.url),
      'utf8',
    ),
  );
  const [source] = await db.select().from(websites).where(eq(websites.teamId, TEAM));
  expect(must(source).schedule.frequency).toBe('manual');
  const scope = withTeam(db, TEAM, MEMBER).websites;
  expect((await scope.page(must(source).id, url))?.currentEventId).toBe(old.event.id);
  expect((await scope.getRun(pendingId)).providerJobId).toBe('provider-existing');
  const latest = await capture(pendingId, new Date('2026-01-02'));
  await db
    .update(websiteSources)
    .set({ pages: [{ url, title: 'New', text: 'New page' }] })
    .where(eq(websiteSources.id, pendingId));
  await db
    .update(documentVersions)
    .set({ processingStatus: 'chunked' })
    .where(eq(documentVersions.id, latest.version.id));
  const [latestChunk] = await db
    .insert(documentChunks)
    .values({
      teamId: TEAM,
      documentId: latest.doc.id,
      documentVersionId: latest.version.id,
      chunkIndex: 0,
      text: 'New page',
      tokenCount: 2,
    })
    .returning();
  await scope.adoptLegacyScan(pendingId);
  expect((await scope.page(must(source).id, url))?.currentEventId).toBe(old.event.id);
  await completeWebsiteChunk(db, TEAM, must(latestChunk).id, 'test-model');
  expect((await scope.page(must(source).id, url))?.currentEventId).toBe(latest.event.id);
  expect((await scope.getRun(pendingId)).unitsPerPage).toBe(1);
  expect(await obsoleteWebsiteEventIds(db, TEAM)).toContain(old.event.id);
  // A callback for the deleted document must not roll the mapping back.
  await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, old.doc.id));
  await db
    .update(rawEvents)
    .set({
      sourceMetadata: {
        websiteId: must(source).id,
        websiteScanId: oldId,
        pageUrl: url,
        websiteContentHash: 'old',
      },
    })
    .where(eq(rawEvents.id, old.event.id));
  const [chunk] = await db
    .insert(documentChunks)
    .values({
      teamId: TEAM,
      documentId: old.doc.id,
      documentVersionId: old.version.id,
      chunkIndex: 0,
      text: 'Old page',
      tokenCount: 2,
    })
    .returning();
  await completeWebsiteChunk(db, TEAM, must(chunk).id, 'test-model');
  expect((await scope.page(must(source).id, url))?.currentEventId).toBe(latest.event.id);
});

it.each([
  ['manual', null],
  ['onboarding', null],
  ['manual', 'provider_failed'],
] as const)(
  'settles cached unchanged %s pages while preserving failure %s',
  async (trigger, failureReason) => {
    const { websiteSources, teamBillingAccounts, billingUsageLedger } =
      await import('@timeline/db');
    const { processPersistentWebsiteScan, websiteContentHash } =
      await import('#src/websites/runtime.js');
    const website = await source();
    const scope = withTeam(db, TEAM, MEMBER);
    const [event] = await db
      .insert(rawEvents)
      .values({
        teamId: TEAM,
        source: 'web',
        contentText: 'Unchanged page',
        sourceMetadata: { websiteId: website.id, pageUrl: website.url },
      })
      .returning();
    const [document] = await db
      .insert(documents)
      .values({
        teamId: TEAM,
        name: 'Page.md',
        fileKind: 'captured',
        ownerUserId: MEMBER,
        sourceRawEventId: must(event).id,
      })
      .returning();
    await db.insert(websitePages).values({
      teamId: TEAM,
      websiteId: website.id,
      url: website.url,
      documentId: must(document).id,
      currentEventId: must(event).id,
      contentHash: websiteContentHash('Unchanged page'),
    });
    const run = await scope.websites.admit({
      websiteId: website.id,
      idempotencyKey: 'cached-unchanged',
      trigger,
    });
    await scope.websites.updateRun(run.id, { failureReason });
    if (trigger === 'onboarding')
      await scope.onboarding.selectStarterPath('website', {
        websiteUrl: website.url,
        websiteHost: 'example.com',
        websiteSubject: 'own_team',
        websiteScanId: run.id,
      });
    await scope.billing.getAccount();
    await db
      .update(teamBillingAccounts)
      .set({ billingState: 'restricted' })
      .where(eq(teamBillingAccounts.teamId, TEAM));
    await db.insert(websiteSources).values({
      id: run.id,
      teamId: TEAM,
      url: website.url,
      websiteSubject: 'own_team',
      pages: [{ url: website.url, title: 'Page', text: 'Unchanged page' }],
    });
    expect(await processPersistentWebsiteScan(db, TEAM, MEMBER, run.id)).toBe(true);
    expect(await processPersistentWebsiteScan(db, TEAM, MEMBER, run.id)).toBe(true);
    const result = await scope.websites.getRun(run.id);
    expect(result.status).toBe(failureReason ? 'partial' : 'completed');
    expect(result.failureReason).toBe(failureReason);
    if (trigger === 'onboarding') {
      const onboarding = await scope.onboarding.getFirstRun();
      expect(onboarding?.phase).toBe('record');
      expect(onboarding?.captureEventId).toBe(must(event).id);
    }
    expect(result.changedCount).toBe(0);
    expect(result.sourceUnits).toBe(20);
    expect(result.pageOutcomes[0]?.status).toBe('unchanged');
    expect(await db.select().from(rawEvents).where(eq(rawEvents.teamId, TEAM))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(billingUsageLedger)
        .where(eq(billingUsageLedger.operationId, `website-scan:${run.id}`)),
    ).toHaveLength(1);
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, must(document).id));
    expect(await scope.websites.page(website.id, website.url)).toBeNull();
  },
);
