// Terminal persistent scans must also finish the matching onboarding progress state.
import { expect, vi } from '@timeline/test-support';
import { afterEach, beforeEach, it } from 'bun:test';

import type * as ScanModule from '#src/onboarding/website-scan.js';
import type * as QueueModule from '#src/queue/queues.js';
import type { Db } from '@timeline/db';

const scan = vi.hoisted(() => vi.fn());
const queued = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
await vi.mock(
  import.meta.resolve('#src/onboarding/website-scan.js'),
  async (original) => ({ ...(await original<typeof ScanModule>()), scanPublicWebsite: scan }),
  () => import('#src/onboarding/website-scan.js'),
);
await vi.mock(
  import.meta.resolve('#src/queue/queues.js'),
  async (original) => ({
    ...(await original<typeof QueueModule>()),
    enqueueWebsiteScanJob: queued,
  }),
  () => import('#src/queue/queues.js'),
);
const { PGlite } = await import('@electric-sql/pglite');
const { drizzle } = await import('drizzle-orm/pglite');
const { eq } = await import('drizzle-orm');
const { teamBillingAccounts, teamMembers, teamFirstRun, billingUsageReservations } =
  await import('@timeline/db');
const { applyDbMigrations } = await import('#src/test/pglite.js');
const { resetEnvForTests } = await import('#src/env.js');
const { withTeam } = await import('#src/team-scope.js');
const { processPersistentWebsiteScan, startWebsiteScan } = await import('#src/websites/runtime.js');
const { failWebsiteRun } = await import('#src/websites/recovery.js');
const TEAM = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEXT_SCAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let pg: InstanceType<typeof PGlite>;
let db: Db;
beforeEach(async () => {
  process.env.FIRECRAWL_API_KEY = 'fixture-only';
  resetEnvForTests();
  scan.mockReset();
  queued.mockClear();
  scan.mockResolvedValue({ ok: false, reason: 'robots' });
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${TEAM}','runtime','Runtime'); INSERT INTO users(id,email) VALUES ('${USER}','runtime@example.test'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner');`,
  );
});
afterEach(async () => {
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.WEBSITE_CRAWLS_DISABLED;
  resetEnvForTests();
  await pg.close();
});
async function fixture(trigger: 'onboarding' | 'manual' = 'onboarding') {
  const scope = withTeam(db, TEAM, USER);
  const website = await scope.websites.add({
    url: 'https://example.com/',
    subject: 'own_team',
    permissionConfirmed: true,
  });
  const run = await scope.websites.admit({
    websiteId: website.id,
    idempotencyKey: 'runtime',
    trigger,
  });
  await scope.onboarding.selectStarterPath('website', {
    websiteUrl: website.url,
    websiteHost: website.hostname,
    websiteSubject: website.subject,
    websiteScanId: run.id,
  });
  return { scope, website, run };
}
it.each(['robots', 'no_readable_text', 'unreachable'] as const)(
  'finishes onboarding for terminal provider failure %s',
  async (reason) => {
    const { scope, run } = await fixture();
    scan.mockResolvedValue({ ok: false, reason });
    expect(await processPersistentWebsiteScan(db, TEAM, USER, run.id)).toBe(true);
    expect((await scope.websites.getRun(run.id)).status).toBe('failed');
    expect(await scope.onboarding.getFirstRun()).toMatchObject({
      phase: 'failed',
      scanFailureReason: reason,
      websiteScanId: run.id,
    });
  },
);
it.each(['start', 'worker'] as const)(
  'finishes onboarding when billing blocks the %s path',
  async (path) => {
    const { scope, website, run } = await fixture();
    await scope.billing.getAccount();
    await db
      .update(teamBillingAccounts)
      .set({ billingState: 'restricted' })
      .where(eq(teamBillingAccounts.teamId, TEAM));
    if (path === 'start')
      await startWebsiteScan(scope, {
        websiteId: website.id,
        idempotencyKey: 'runtime',
        permissionConfirmed: true,
        trigger: 'onboarding',
      });
    else await processPersistentWebsiteScan(db, TEAM, USER, run.id);
    expect((await scope.websites.getRun(run.id)).status).toBe('blocked');
    expect(await scope.onboarding.getFirstRun()).toMatchObject({
      phase: 'failed',
      scanFailureReason: 'billing_limited',
    });
    expect(scan).not.toHaveBeenCalled();
  },
);
it.each(['ambiguous', 'paused', 'disabled', 'replayed', 'cleanup'] as const)(
  'finishes matching onboarding on %s termination',
  async (cause) => {
    const { scope, website, run } = await fixture();
    if (cause === 'ambiguous')
      await scope.websites.updateRun(run.id, { providerStartedAt: new Date() });
    if (cause === 'paused') await scope.websites.configure(website.id, { paused: true });
    if (cause === 'disabled') {
      process.env.WEBSITE_CRAWLS_DISABLED = 'true';
      resetEnvForTests();
    }
    if (cause === 'replayed')
      await scope.websites.updateRun(run.id, {
        status: 'failed',
        failureReason: 'robots',
        finishedAt: new Date(),
      });
    if (cause === 'cleanup') await failWebsiteRun(db, TEAM, run.id, 'processing_timeout');
    else await processPersistentWebsiteScan(db, TEAM, USER, run.id);
    expect((await scope.onboarding.getFirstRun())?.phase).toBe('failed');
    expect(scan).not.toHaveBeenCalled();
  },
);
it.each(['runtime', 'cleanup'] as const)(
  'does not fail a newer onboarding scan through %s',
  async (path) => {
    const { scope, website, run } = await fixture();
    await scope.onboarding.selectStarterPath('website', {
      websiteUrl: website.url,
      websiteHost: website.hostname,
      websiteSubject: website.subject,
      websiteScanId: NEXT_SCAN,
    });
    if (path === 'cleanup') await failWebsiteRun(db, TEAM, run.id, 'processing_timeout');
    else await processPersistentWebsiteScan(db, TEAM, USER, run.id);
    expect(await scope.onboarding.getFirstRun()).toMatchObject({
      phase: 'processing',
      websiteScanId: NEXT_SCAN,
    });
  },
);
it('does not change onboarding for an ordinary manual scan', async () => {
  const { scope, run } = await fixture('manual');
  await processPersistentWebsiteScan(db, TEAM, USER, run.id);
  expect((await scope.onboarding.getFirstRun())?.phase).toBe('processing');
});

it('cleans up billing and onboarding after the actor is removed and the workspace suspended', async () => {
  const { scope, run } = await fixture();
  await scope.billing.reserve({
    operationId: `website-scan:${run.id}`,
    meterId: 'accepted_sources',
    reservedNativeUnits: 100,
    reservedChargeCents: 5,
  });
  await db.update(teamMembers).set({ removedAt: new Date() }).where(eq(teamMembers.teamId, TEAM));
  await db
    .update(teamBillingAccounts)
    .set({ securityState: 'suspended' })
    .where(eq(teamBillingAccounts.teamId, TEAM));
  await failWebsiteRun(db, TEAM, run.id, 'actor_no_longer_authorized');
  expect(
    (await db.select().from(teamFirstRun).where(eq(teamFirstRun.teamId, TEAM)))[0]?.phase,
  ).toBe('failed');
  expect(
    (
      await db
        .select()
        .from(billingUsageReservations)
        .where(eq(billingUsageReservations.teamId, TEAM))
    )[0]?.state,
  ).toBe('released');
  expect(scan).not.toHaveBeenCalled();
});
