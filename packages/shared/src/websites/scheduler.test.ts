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
const {
  teams,
  websites,
  websiteRuns,
  teamBillingAccounts,
  notifications,
  platformImpersonationSessions,
  users,
} = await import('@timeline/db');
const { applyDbMigrations } = await import('#src/test/pglite.js');
const { resetEnvForTests } = await import('#src/env.js');
const { withTeam } = await import('#src/team-scope.js');
const { tickWebsiteSchedules } = await import('#src/websites/scheduler.js');
const { startWebsiteScan } = await import('#src/websites/runtime.js');
const { startImpersonation, resolveImpersonation, endImpersonation } =
  await import('#src/platform-admin/index.js');
const { operatorContext, registerOperatorContextResolver, runGuardedJob } =
  await import('#src/platform-admin/runtime.js');
import type { Db } from '@timeline/db';
const TEAM = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const operatorActor = { userId: ADMIN, email: 'operator@example.test' };
let pg: InstanceType<typeof PGlite>;
let db: Db;
beforeEach(async () => {
  process.env.FIRECRAWL_API_KEY = 'test-only';
  process.env.WEBSITE_SCHEDULES_ENABLED = 'true';
  resetEnvForTests();
  queued.mockReset();
  queued.mockResolvedValue(undefined);
  registerOperatorContextResolver(() => Promise.resolve(null));
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO teams(id,slug,name) VALUES ('${TEAM}','scheduled','Scheduled'); INSERT INTO users(id,email) VALUES ('${USER}','scheduler@example.test'); INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${USER}','owner');`,
  );
});
afterEach(async () => {
  registerOperatorContextResolver(() => Promise.resolve(null));
  delete process.env.PLATFORM_ADMIN_EMAILS;
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

async function beginOperatorSession() {
  process.env.PLATFORM_ADMIN_EMAILS = operatorActor.email;
  resetEnvForTests();
  await db
    .insert(users)
    .values({ id: ADMIN, email: operatorActor.email, emailVerified: new Date() });
  const { token } = await startImpersonation(db, operatorActor, {
    teamId: TEAM,
    userId: USER,
    purpose: 'Investigate website scan failure',
    reference: 'SUP-website',
    authorization: 'Customer requested support',
  });
  const { session } = await resolveImpersonation(db, operatorActor, token);
  registerOperatorContextResolver(() =>
    Promise.resolve({
      actorUserId: ADMIN,
      actorEmail: operatorActor.email,
      effectiveUserId: USER,
      teamId: TEAM,
      sessionId: session.id,
      readOnly: false,
    }),
  );
  return { token, session };
}

it('restores durable operator attribution when recovering a failed initial enqueue', async () => {
  const { token, session } = await beginOperatorSession();
  const { source, scope } = await dueSource();
  queued.mockRejectedValueOnce(new Error('queue unavailable'));
  await expect(
    startWebsiteScan(scope, {
      websiteId: source.id,
      idempotencyKey: 'operator-recovery',
      permissionConfirmed: true,
    }),
  ).rejects.toThrow('queue unavailable');
  const [run] = await db.select().from(websiteRuns);
  if (!run) throw new Error('Expected durable admitted run');
  expect(run.platformOperatorSessionId).toBe(session.id);
  registerOperatorContextResolver(() => Promise.resolve(null));
  queued.mockClear();
  await tickWebsiteSchedules(db);
  expect(queued).toHaveBeenCalledWith({
    teamId: TEAM,
    userId: USER,
    scanId: run.id,
    platformOperatorSessionId: session.id,
  });
  const untaggedJob = { teamId: TEAM, userId: USER, scanId: run.id };
  expect(
    await runGuardedJob(untaggedJob, async () => (await operatorContext())?.sessionId, db),
  ).toBe(session.id);
  const executeProvider = vi.fn().mockResolvedValue(undefined);
  await expect(
    runGuardedJob({ ...untaggedJob, userId: ADMIN }, executeProvider, db),
  ).rejects.toThrow('attribution');
  await expect(
    runGuardedJob({ ...untaggedJob, platformOperatorSessionId: ADMIN }, executeProvider, db),
  ).rejects.toThrow('attribution');
  await endImpersonation(db, ADMIN, token);
  await expect(runGuardedJob(untaggedJob, executeProvider, db)).rejects.toThrow(
    'authorization expired',
  );
  expect(executeProvider).not.toHaveBeenCalled();
});

it('terminates queued recovery and pauses its schedule after operator expiry', async () => {
  const { session } = await beginOperatorSession();
  const { source, scope } = await dueSource();
  queued.mockRejectedValueOnce(new Error('queue unavailable'));
  await expect(
    startWebsiteScan(scope, {
      websiteId: source.id,
      idempotencyKey: 'expired-recovery',
      permissionConfirmed: true,
    }),
  ).rejects.toThrow('queue unavailable');
  registerOperatorContextResolver(() => Promise.resolve(null));
  await db
    .update(platformImpersonationSessions)
    .set({ expiresAt: new Date(0) })
    .where(eq(platformImpersonationSessions.id, session.id));
  queued.mockClear();
  await tickWebsiteSchedules(db);
  const [run] = await db.select().from(websiteRuns);
  expect(run).toMatchObject({
    status: 'failed',
    failureReason: 'actor_no_longer_authorized',
    providerStartedAt: null,
  });
  expect((await scope.websites.get(source.id)).paused).toBe(true);
  expect(queued).not.toHaveBeenCalled();
});

it('restores an active schedule operator session onto the newly admitted run', async () => {
  const { session } = await beginOperatorSession();
  const { source, scope } = await dueSource();
  expect((await scope.websites.get(source.id)).scheduleOperatorSessionId).toBe(session.id);
  registerOperatorContextResolver(() => Promise.resolve(null));
  await tickWebsiteSchedules(db);
  const [run] = await db.select().from(websiteRuns);
  expect(run).toMatchObject({ trigger: 'scheduled', platformOperatorSessionId: session.id });
  expect(queued).toHaveBeenCalledWith(
    expect.objectContaining({ platformOperatorSessionId: session.id }),
  );
});

it('pauses a due schedule without admitting work after operator revocation', async () => {
  const { token } = await beginOperatorSession();
  const { source, scope } = await dueSource();
  registerOperatorContextResolver(() => Promise.resolve(null));
  await endImpersonation(db, ADMIN, token);
  await tickWebsiteSchedules(db);
  expect(await db.select().from(websiteRuns)).toHaveLength(0);
  expect(await scope.websites.get(source.id)).toMatchObject({
    paused: true,
    nextScanAt: null,
    blockedReason: 'schedule_authorization_lost',
  });
  expect(queued).not.toHaveBeenCalled();
});

it('rejects a stale due identity after an administrator reconfigures the schedule', async () => {
  const { session } = await beginOperatorSession();
  const { source, scope } = await dueSource();
  const dueAt = (await scope.websites.get(source.id)).nextScanAt;
  if (!dueAt) throw new Error('Expected due schedule');
  registerOperatorContextResolver(() => Promise.resolve(null));
  await scope.websites.configure(source.id, {
    schedule: { frequency: 'weekly', time: '10:00', weekday: 2, timezone: 'UTC' },
  });
  await expect(
    runGuardedJob(
      { teamId: TEAM, userId: USER, platformOperatorSessionId: session.id },
      () =>
        startWebsiteScan(scope, {
          websiteId: source.id,
          trigger: 'scheduled',
          permissionConfirmed: true,
          idempotencyKey: `schedule:${source.id}:${dueAt.toISOString()}`,
        }),
      db,
    ),
  ).rejects.toThrow('schedule changed');
  expect(await db.select().from(websiteRuns)).toHaveLength(0);
  expect(queued).not.toHaveBeenCalled();
  expect((await scope.websites.get(source.id)).paused).toBe(false);
});

it('preserves disabled website schedules and does not publish their queued runs', async () => {
  const { source } = await dueSource();
  await db.insert(websiteRuns).values({
    teamId: TEAM,
    websiteId: source.id,
    requestedBy: USER,
    trigger: 'manual',
    idempotencyKey: 'disabled-fixture',
  });
  await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, TEAM));
  await tickWebsiteSchedules(db);
  expect(queued).not.toHaveBeenCalled();
  const [saved] = await db.select().from(websites).where(eq(websites.id, source.id));
  expect(saved?.nextScanAt?.getTime()).toBeLessThan(Date.now());
  expect(saved?.paused).toBe(false);
  expect((await db.select().from(websiteRuns))[0]?.status).toBe('queued');
});
