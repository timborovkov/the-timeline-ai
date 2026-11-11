// Durable schedule identities and billing-block episodes survive repeated worker ticks.
import { expect, vi } from '@timeline/test-support';
import { beforeEach, afterEach, it } from 'bun:test';

import type * as QueueModule from '#src/queue/queues.js';
const queued = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
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
const { websites, websiteRuns, teamBillingAccounts, notifications } = await import('@timeline/db');
const { applyDbMigrations } = await import('#src/test/pglite.js');
const { resetEnvForTests } = await import('#src/env.js');
const { withTeam } = await import('#src/team-scope.js');
const { tickWebsiteSchedules } = await import('#src/websites/scheduler.js');
import type { Db } from '@timeline/db';
const TEAM = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let pg: InstanceType<typeof PGlite>;
let db: Db;
beforeEach(async () => {
  process.env.FIRECRAWL_API_KEY = 'test-only';
  process.env.WEBSITE_SCHEDULES_ENABLED = 'true';
  resetEnvForTests();
  queued.mockClear();
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${TEAM}','scheduled','Scheduled'); INSERT INTO users(id,email) VALUES ('${USER}','scheduler@example.test'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner');`,
  );
});
afterEach(async () => {
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.WEBSITE_SCHEDULES_ENABLED;
  resetEnvForTests();
  await pg.close();
});
async function dueSource() {
  const scope = withTeam(db, TEAM, USER);
  const source = await scope.websites.add({
    url: 'https://example.com',
    subject: 'own_team',
    permissionConfirmed: true,
  });
  await scope.websites.configure(source.id, {
    schedule: { frequency: 'daily', time: '09:00', weekday: 1, timezone: 'UTC' },
  });
  await db
    .update(websites)
    .set({ nextScanAt: new Date(Date.now() - 3 * 86400_000) })
    .where(eq(websites.id, source.id));
  return { source, scope };
}
it('creates one catch-up run, advances the calendar and recovers the same queued identity', async () => {
  const { source, scope } = await dueSource();
  await tickWebsiteSchedules(db);
  await tickWebsiteSchedules(db);
  const runs = await db.select().from(websiteRuns);
  expect(runs).toHaveLength(1);
  expect(runs[0]?.trigger).toBe('scheduled');
  expect(runs[0]?.unitsPerPage).toBe(20);
  expect((await scope.websites.get(source.id)).nextScanAt?.getTime()).toBeGreaterThan(Date.now());
  expect(
    queued.mock.calls.every(([job]) => (job as { scanId: string }).scanId === runs[0]?.id),
  ).toBe(true);
});
it('notifies once across billing-blocked due times and preserves explicit pause', async () => {
  const { source, scope } = await dueSource();
  await scope.billing.getAccount();
  await db
    .update(teamBillingAccounts)
    .set({ billingState: 'restricted' })
    .where(eq(teamBillingAccounts.teamId, TEAM));
  await tickWebsiteSchedules(db);
  await db
    .update(websites)
    .set({ lastScanAt: new Date(0), nextScanAt: new Date(Date.now() - 86400_000) })
    .where(eq(websites.id, source.id));
  await tickWebsiteSchedules(db);
  expect(await db.select().from(notifications)).toHaveLength(1);
  expect((await scope.websites.get(source.id)).blockedReason).toBe('billing_limited');
  expect(queued).not.toHaveBeenCalled();
  await scope.websites.configure(source.id, { paused: true });
  await db
    .update(teamBillingAccounts)
    .set({ billingState: 'free' })
    .where(eq(teamBillingAccounts.teamId, TEAM));
  await tickWebsiteSchedules(db);
  expect((await scope.websites.get(source.id)).paused).toBe(true);
  expect(queued).not.toHaveBeenCalled();
});

it('keeps an onboarding website in Sources with the same shared run after leaving onboarding', async () => {
  const { startWebsiteScan } = await import('#src/websites/runtime.js');
  const scope = withTeam(db, TEAM, USER);
  const scanId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await scope.onboarding.selectStarterPath('website', {
    websiteUrl: 'https://example.com/',
    websiteHost: 'example.com',
    websiteSubject: 'own_team',
    websiteScanId: scanId,
  });
  const source = await scope.websites.add({
    url: 'https://example.com/',
    subject: 'own_team',
    permissionConfirmed: true,
  });
  const run = await startWebsiteScan(scope, {
    websiteId: source.id,
    scanId,
    idempotencyKey: `onboarding:${scanId}`,
    trigger: 'onboarding',
    permissionConfirmed: true,
  });
  expect(run.id).toBe(scanId);
  expect(run.websiteId).toBe(source.id);
  expect(run.billingPolicy).toBe('website-v1');
  expect(run.unitsPerPage).toBe(20);
  await scope.onboarding.skipToEmptyHome();
  expect(await scope.websites.list()).toEqual([
    expect.objectContaining({
      id: source.id,
      schedule: expect.objectContaining({ frequency: 'manual' }) as unknown,
    }),
  ]);
  expect(await scope.websites.history(source.id)).toEqual([
    expect.objectContaining({ id: scanId, trigger: 'onboarding', status: 'queued' }),
  ]);
  expect(queued).toHaveBeenCalledWith({ teamId: TEAM, userId: USER, scanId });
});
