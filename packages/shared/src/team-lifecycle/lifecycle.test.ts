import { readFileSync } from 'node:fs';

/** Exercise real migrations and tenant state: deletion must never damage another team or reopen access. */
import { PGlite } from '@electric-sql/pglite';
import { teams, teamMembers, teamBillingAccounts, schema, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq, is, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';

import { resetEnvForTests } from '#src/env.js';
import { setPlatformSuspension, listPlatformTeams } from '#src/platform-admin/index.js';
import {
  assertActivePrincipal,
  registerOperatorContextResolver,
} from '#src/platform-admin/runtime.js';
import { beginTeamDeletion, retryTeamLifecycle } from '#src/team-lifecycle/admin.js';
import {
  PURGED_TEAM_TABLES,
  RETAINED_TEAM_TABLES,
  INDIRECT_AND_ACCOUNT_TABLES,
} from '#src/team-lifecycle/inventory.js';
import { processTeamLifecycle } from '#src/team-lifecycle/processor.js';
import { purgeTeamRows, verifyTeamRows } from '#src/team-lifecycle/purge.js';
import { teamOwnsStorageKey } from '#src/team-lifecycle/storage.js';
import { withTeam } from '#src/team-scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const ADMIN = '11111111-2222-4333-8444-555555555555';
const OWNER = '22222222-3333-4444-8555-666666666666';
const TEAM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';
const actor = { userId: ADMIN, email: 'ops@example.test' };
let pg: PGlite;
let db: Db;
beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO users (id,email,"emailVerified") VALUES ('${ADMIN}','ops@example.test',now()),('${OWNER}','owner@example.test',now()); INSERT INTO teams (id,name,slug,inbound_email) VALUES ('${TEAM}','First','first','first@example.test'),('${OTHER}','Other','other','other@example.test'); INSERT INTO team_members (team_id,user_id,role) VALUES ('${TEAM}','${OWNER}','owner'),('${OTHER}','${OWNER}','owner');`,
  );
  process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  resetEnvForTests();
  registerOperatorContextResolver(() => Promise.resolve(null));
});
afterEach(async () => {
  await pg.close();
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetEnvForTests();
});

describe('team lifecycle', () => {
  it('requires ownership and exact confirmation before immediately disabling', async () => {
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('Wrong')).rejects.toThrow(
      'exact team name',
    );
    await db.update(teamMembers).set({ role: 'member' }).where(eq(teamMembers.teamId, TEAM));
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'Only team owners',
    );
    await db.update(teamMembers).set({ role: 'owner' }).where(eq(teamMembers.teamId, TEAM));
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork).toMatchObject({ billingPending: true, notificationPending: true });
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    await assertActivePrincipal(db, OTHER);
    await db.delete(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, TEAM));
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    await expect(
      pg.exec(
        `INSERT INTO team_invites (team_id,email,role,token,invited_by_user_id,expires_at) VALUES ('${TEAM}','late@example.test','member','late','${OWNER}',now())`,
      ),
    ).rejects.toThrow('disabled');
  });
  it('backfills unknown historical suspensions without relying on billing for access', async () => {
    await pg.exec(
      `INSERT INTO team_billing_accounts (team_id,security_state) VALUES ('${TEAM}','suspended')`,
    );
    const migration = readFileSync(
      new URL('../../../db/drizzle/0103_team_lifecycle.sql', import.meta.url),
      'utf8',
    );
    await pg.exec(
      migration.slice(
        migration.indexOf('UPDATE teams t SET disabled_at = COALESCE'),
        migration.indexOf('CREATE INDEX teams_lifecycle_work_idx'),
      ),
    );
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork).toMatchObject({ disabledDateUnknown: true, billingPending: true });
    await db.delete(teamBillingAccounts).where(eq(teamBillingAccounts.teamId, TEAM));
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
  });
  it('rejects owner requests made through impersonation', async () => {
    registerOperatorContextResolver(() =>
      Promise.resolve({
        actorUserId: ADMIN,
        actorEmail: actor.email,
        effectiveUserId: OWNER,
        teamId: TEAM,
        sessionId: OTHER,
        readOnly: false,
      }),
    );
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'administrator identity for account management',
    );
  });
  it('retains a request and retries notification failure independently of cancellation', async () => {
    const originalKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = '';
    resetEnvForTests();
    try {
      await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
      await processTeamLifecycle(db, {
        objects: () => Promise.resolve(true),
        vectors: () => Promise.resolve(),
        queues: () => Promise.resolve(true),
      });
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      expect(team?.deletionRequestedAt).not.toBeNull();
      expect(team?.lifecycleWork.notificationPending).toBe(true);
      expect(team?.lifecycleWork.billingPending).toBe(false);
      await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('disabled');
    } finally {
      if (originalKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalKey;
      resetEnvForTests();
    }
  });
  it('restores without losing disabled-period history and clears the request', async () => {
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Owner withdrew request');
    await assertActivePrincipal(db, TEAM);
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.deletionRequestedAt).toBeNull();
    expect(team?.disabledPeriods[0]?.end).toBeDefined();
    expect(team?.lifecycleWork.billingPending).toBe(true);
  });
  it('preserves preexisting security restrictions when restoring a deletion request', async () => {
    await db.insert(teamBillingAccounts).values({ teamId: TEAM, securityState: 'restricted' });
    await withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First');
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'Owner withdrew request');
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, TEAM));
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(account?.securityState).toBe('restricted');
    expect(team?.disabledAt).toBeNull();
    expect(team?.deletionRequestedAt).toBeNull();
    expect(team?.lifecycleWork.billingPending).toBe(true);
  });
  it('permanently deletes operational rows, retains the other team, and reserves old routes', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Verified owner request',
    });
    await expect(setPlatformSuspension(db, actor, 'team', TEAM, false, 'Undo')).rejects.toThrow(
      'cannot be reversed',
    );
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt++) done = await purgeTeamRows(db, TEAM);
    expect(done).toBe(true);
    await verifyTeamRows(db, TEAM);
    const remaining = await db.select().from(teamMembers).where(eq(teamMembers.teamId, OTHER));
    expect(remaining).toHaveLength(1);
    await db
      .update(teams)
      .set({ slug: 'deleted-first', inboundEmail: null })
      .where(eq(teams.id, TEAM));
    await expect(pg.exec("INSERT INTO teams (name,slug) VALUES ('New','first')")).rejects.toThrow(
      'retired',
    );
  });
  it('settled recovery metadata and disconnected sources do not strand cleanup', async () => {
    await pg.exec(`INSERT INTO billing_usage_reservations (team_id,operation_id,meter_id,reserved_native_units,reserved_charge_cents,state,expires_at,metadata) VALUES ('${TEAM}','settled-fixture','ai',1,1,'settled',now(),'{"worker_settlement_pending":true}');
      INSERT INTO integrations (team_id,provider,display_name,enabled) VALUES ('${TEAM}','google_drive','Disconnected',false);`);
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Fixture cleanup',
    });
    const io = {
      objects: () => Promise.resolve(true),
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(team?.lifecycleWork.error).toBeUndefined();
    expect(['purge', 'verify']).toContain(team?.lifecycleWork.stage);
  });
  it('keeps failed cleanup disabled and resumes without erasing the control team', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Authorized fixture removal',
    });
    let fail = true;
    const io = {
      objects: () => {
        if (fail) return Promise.reject(new Error('provider secret must not be persisted'));
        return Promise.resolve(true);
      },
      queues: () => Promise.resolve(true),
      vectors: () => Promise.resolve(),
    };
    await processTeamLifecycle(db, io);
    await processTeamLifecycle(db, io);
    await processTeamLifecycle(db, io);
    const [failed] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(failed?.lifecycleWork.error).toBe('Cleanup step purge requires retry');
    expect(failed?.deletedAt).toBeNull();
    fail = false;
    await retryTeamLifecycle(db, actor, TEAM);
    for (let tick = 0; tick < 6; tick++) {
      await processTeamLifecycle(db, io);
      const [team] = await db.select().from(teams).where(eq(teams.id, TEAM));
      if (team?.lifecycleWork.stage === 'verify')
        await db
          .update(teams)
          .set({ lifecycleWork: { ...team.lifecycleWork, retryAt: new Date(0).toISOString() } })
          .where(eq(teams.id, TEAM));
    }
    const [completed] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(completed?.deletedAt).not.toBeNull();
    expect(completed?.name).toBe('Deleted team');
    expect(completed?.lifecycleWork.followups?.every((item) => item.status === 'pending')).toBe(
      true,
    );
    await assertActivePrincipal(db, OTHER);
  });
  it('does not expose maintenance methods through an ordinary owner scope', async () => {
    await expect(withTeam(db, TEAM, OWNER).lifecycle.purgeRows()).rejects.toThrow(
      'internal system scope',
    );
  });
  it('waits for bounded object batches and the upload expiry window before verifying late writes', async () => {
    await beginTeamDeletion(db, actor, {
      teamId: TEAM,
      confirmation: 'First',
      reason: 'Verify late uploads',
    });
    const objects = new Set(['initial upload']);
    let objectPasses = 0;
    let batchComplete = false;
    const io = {
      objects: () => {
        objectPasses++;
        if (!batchComplete) return Promise.resolve(false);
        objects.clear();
        return Promise.resolve(true);
      },
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [waiting] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(waiting?.lifecycleWork.stage).toBe('purge');
    expect(waiting?.deletedAt).toBeNull();
    expect(objects.size).toBe(1);
    batchComplete = true;
    for (let tick = 0; tick < 4; tick++) await processTeamLifecycle(db, io);
    const [verifying] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(verifying?.lifecycleWork.stage).toBe('verify');
    expect(objects.size).toBe(0);
    objects.add('upload completed after the first purge');
    const passesBeforeRetry = objectPasses;
    await retryTeamLifecycle(db, actor, TEAM);
    await processTeamLifecycle(db, io);
    expect(objectPasses).toBe(passesBeforeRetry);
    const [stillWaiting] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(stillWaiting?.deletedAt).toBeNull();
    expect(stillWaiting?.lifecycleWork.retryAt).toBe(verifying?.lifecycleWork.retryAt);
    if (!stillWaiting) throw new Error('Missing deletion fixture');
    await db
      .update(teams)
      .set({
        lifecycleWork: { ...stillWaiting.lifecycleWork, retryAt: new Date(0).toISOString() },
      })
      .where(eq(teams.id, TEAM));
    await processTeamLifecycle(db, io);
    expect(objects.size).toBe(0);
    const [complete] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(complete?.deletedAt).not.toBeNull();
    await assertActivePrincipal(db, OTHER);
  });
  it('rejects forged administrative authority and team-admin deletion requests', async () => {
    await expect(
      beginTeamDeletion(
        db,
        { userId: OWNER, email: actor.email },
        {
          teamId: TEAM,
          confirmation: 'First',
          reason: 'Forged administrator',
        },
      ),
    ).rejects.toThrow();
    await db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.teamId, TEAM));
    await expect(withTeam(db, TEAM, OWNER).lifecycle.requestDeletion('First')).rejects.toThrow(
      'Only team owners',
    );
    await db.delete(teamMembers).where(eq(teamMembers.teamId, OTHER));
    await expect(withTeam(db, OTHER, OWNER).lifecycle.requestDeletion('Other')).rejects.toThrow();
    const [unchanged] = await db.select().from(teams).where(eq(teams.id, TEAM));
    expect(unchanged?.disabledAt).toBeNull();
    expect(unchanged?.deletionStartedAt).toBeNull();
  });
  it('filters and sorts teams before counting and paginating', async () => {
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'Paused');
    const result = await listPlatformTeams(db, actor, '', 1, {
      status: 'disabled',
      sort: 'name',
      direction: 'asc',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.id).toBe(TEAM);
    expect(
      (await listPlatformTeams(db, actor, '', 1, { status: 'active' })).rows.map((row) => row.id),
    ).toEqual([OTHER]);
  });
  it('classifies every team table and matches storage ownership exactly', () => {
    const actual = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableConfig(table))
      .filter((table) => table.columns.some((column) => column.name === 'team_id'))
      .map((table) => table.name)
      .sort();
    expect([...PURGED_TEAM_TABLES, ...RETAINED_TEAM_TABLES].sort()).toEqual(actual);
    const indirect = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableConfig(table))
      .filter((table) => !table.columns.some((column) => column.name === 'team_id'))
      .map((table) => table.name)
      .sort();
    expect([...INDIRECT_AND_ACCOUNT_TABLES].sort()).toEqual(indirect);
    expect(teamOwnsStorageKey(`teams/${TEAM}/audio/voice.wav`, TEAM)).toBe(true);
    expect(teamOwnsStorageKey(`${OTHER}/file`, TEAM)).toBe(false);
    expect(teamOwnsStorageKey(`${OTHER}/document/v1/${TEAM}`, TEAM)).toBe(false);
    expect(teamOwnsStorageKey(`teams/${TEAM}-other/file`, TEAM)).toBe(false);
  });
});
