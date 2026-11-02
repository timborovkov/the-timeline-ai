import { PGlite } from '@electric-sql/pglite';
import { platformAdminAudit, platformImpersonationSessions, users, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { resetEnvForTests } from '#src/env.js';
import {
  directoryPage,
  endImpersonation,
  listPlatformUsers,
  renamePlatformEntity,
  requirePlatformActor,
  resolveImpersonation,
  setPlatformSuspension,
  startImpersonation,
} from '#src/platform-admin/index.js';
import {
  assertActivePrincipal,
  operatorDatabase,
  guardOperatorScope,
  registerOperatorContextResolver,
  runGuardedJob,
  tagOperatorJob,
} from '#src/platform-admin/runtime.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const ADMIN = '11111111-2222-4333-8444-555555555555';
const MEMBER = '22222222-3333-4444-8555-666666666666';
const TEAM = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef';
const actor = { userId: ADMIN, email: 'ops@example.test' };
let pg: PGlite;
let db: Db;
const input = {
  teamId: TEAM,
  userId: MEMBER,
  purpose: 'Investigate customer report',
  reference: 'SUP-123',
  authorization: 'Customer request approved by operator',
};
beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  db = drizzle(pg) as unknown as Db;
  await pg.exec(
    `INSERT INTO users (id,email,"emailVerified") VALUES ('${ADMIN}','ops@example.test',now()),('${MEMBER}','member@example.test',now()); INSERT INTO teams (id,name,slug) VALUES ('${TEAM}','First','first'),('${OTHER}','Other','other'); INSERT INTO team_members (team_id,user_id,role) VALUES ('${TEAM}','${MEMBER}','member');`,
  );
  process.env.PLATFORM_ADMIN_EMAILS = ' OPS@example.test ';
  resetEnvForTests();
  registerOperatorContextResolver(() => Promise.resolve(null));
});
afterEach(async () => {
  registerOperatorContextResolver(() => Promise.resolve(null));
  delete process.env.PLATFORM_ADMIN_EMAILS;
  resetEnvForTests();
  await pg.close();
});

describe('platform administrator boundary', () => {
  it('authorizes a verified allowlisted user without any team memberships', async () => {
    expect((await requirePlatformActor(db, actor)).id).toBe(ADMIN);
  });
  it('rejects unverified, mismatched, ordinary and removed-allowlist identities', async () => {
    await expect(
      requirePlatformActor(db, { userId: MEMBER, email: 'member@example.test' }),
    ).rejects.toThrow();
    await expect(
      requirePlatformActor(db, { ...actor, email: 'another@example.test' }),
    ).rejects.toThrow();
    await db.update(users).set({ emailVerified: null }).where(eq(users.id, ADMIN));
    await expect(requirePlatformActor(db, actor)).rejects.toThrow();
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, ADMIN));
    process.env.PLATFORM_ADMIN_EMAILS = '';
    resetEnvForTests();
    await expect(requirePlatformActor(db, actor)).rejects.toThrow();
  });
  it('searches literal wildcard characters and clamps invalid pages', async () => {
    expect(directoryPage('-1')).toBe(1);
    expect(directoryPage('2.5')).toBe(1);
    expect((await listPlatformUsers(db, actor, '%', 1)).total).toBe(0);
    expect((await listPlatformUsers(db, actor, 'member@', 1)).total).toBe(1);
    await db
      .insert(users)
      .values(Array.from({ length: 51 }, (_, i) => ({ email: `directory-${i}@example.test` })));
    const first = await listPlatformUsers(db, actor, 'directory-', 1);
    const second = await listPlatformUsers(db, actor, 'directory-', 2);
    expect(first.rows.length).toBe(50);
    expect(second.rows.length).toBe(1);
    expect(first.total).toBe(51);
    expect(first.rows.some((row) => row.id === second.rows[0]?.id)).toBe(false);
  });
  it('renames with an immutable audit record', async () => {
    await renamePlatformEntity(db, actor, 'user', MEMBER, 'Member name');
    expect((await db.select().from(platformAdminAudit))[0]?.action).toBe('user.rename');
    await expect(pg.exec('DELETE FROM platform_admin_audit')).rejects.toThrow('append-only');
  });
  it('suspends and restores users, protecting platform administrators', async () => {
    await expect(
      setPlatformSuspension(db, actor, 'user', ADMIN, true, 'test suspension'),
    ).rejects.toThrow();
    await setPlatformSuspension(db, actor, 'user', MEMBER, true, 'customer incident');
    await expect(assertActivePrincipal(db, TEAM, MEMBER)).rejects.toThrow('Account is suspended');
    await setPlatformSuspension(db, actor, 'user', MEMBER, false, 'incident resolved');
    await assertActivePrincipal(db, TEAM, MEMBER);
  });
  it('restores a team to its previous security state without changing billing', async () => {
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'customer incident');
    await expect(assertActivePrincipal(db, TEAM)).rejects.toThrow('Workspace is suspended');
    await setPlatformSuspension(db, actor, 'team', TEAM, false, 'incident resolved');
    await assertActivePrincipal(db, TEAM);
  });
  it('permits internal cleanup but rejects normal suspended work', async () => {
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'customer incident');
    const { withTeam } = await import('#src/team-scope.js');
    const scope = withTeam(db, TEAM, '00000000-0000-0000-0000-000000000000', {
      skipMembershipCheck: true,
    });
    await expect(scope.mcpOAuth.pruneExpiredCredentials()).resolves.toBeDefined();
    await expect(
      runGuardedJob({ teamId: TEAM, userId: MEMBER }, () => Promise.resolve('bad'), db),
    ).rejects.toThrow('suspended');
  });
});

describe('impersonation lifecycle', () => {
  it('stores only a hash, preserves the member role and revokes on exit', async () => {
    const session = await startImpersonation(db, actor, input);
    const stored = (await db.select().from(platformImpersonationSessions))[0];
    expect(stored?.tokenHash).not.toBe(session.token);
    expect((await resolveImpersonation(db, actor, session.token)).role).toBe('member');
    await endImpersonation(db, ADMIN, session.token);
    await expect(resolveImpersonation(db, actor, session.token)).rejects.toThrow();
  });
  it('rejects forged tokens, another actor, removed members, and expired sessions', async () => {
    const { token } = await startImpersonation(db, actor, input);
    await expect(resolveImpersonation(db, actor, 'forged')).rejects.toThrow();
    await expect(
      resolveImpersonation(db, { userId: MEMBER, email: 'member@example.test' }, token),
    ).rejects.toThrow();
    await db.update(platformImpersonationSessions).set({ expiresAt: new Date(0) });
    await expect(resolveImpersonation(db, actor, token)).rejects.toThrow('expired');
    expect(
      (await db.select().from(platformAdminAudit)).some((e) => e.action === 'impersonation.expire'),
    ).toBe(true);
  });
  it('invalidates membership changes and allowlist removal', async () => {
    const { token } = await startImpersonation(db, actor, input);
    await pg.exec(
      `UPDATE team_members SET authorization_epoch = gen_random_uuid() WHERE user_id = '${MEMBER}'`,
    );
    await expect(resolveImpersonation(db, actor, token)).rejects.toThrow('membership changed');
    process.env.PLATFORM_ADMIN_EMAILS = '';
    resetEnvForTests();
    await expect(resolveImpersonation(db, actor, token)).rejects.toThrow();
  });
  it('audits scoped reads and blocks cross-team and suspended writes', async () => {
    const { token } = await startImpersonation(db, actor, input);
    const ownEvent = crypto.randomUUID();
    const otherEvent = crypto.randomUUID();
    await pg.exec(
      `INSERT INTO raw_events (id,team_id,author_user_id,source,visibility,visibility_owner_user_id) VALUES ('${ownEvent}','${TEAM}','${MEMBER}','web','private','${MEMBER}'),('${otherEvent}','${TEAM}','${ADMIN}','web','private','${ADMIN}')`,
    );
    await setPlatformSuspension(db, actor, 'user', MEMBER, true, 'test incident');
    const resolved = await resolveImpersonation(db, actor, token);
    expect(resolved.readOnly).toBe(true);
    registerOperatorContextResolver(() =>
      Promise.resolve({
        actorUserId: ADMIN,
        actorEmail: actor.email,
        effectiveUserId: MEMBER,
        teamId: TEAM,
        sessionId: resolved.session.id,
        readOnly: true,
      }),
    );
    const scope = guardOperatorScope(db, TEAM, MEMBER, {
      getItem: () => Promise.resolve('visible'),
      updateItem: () => Promise.resolve('changed'),
    });
    const { withTeam } = await import('#src/team-scope.js');
    const workspace = withTeam(db, TEAM, MEMBER);
    expect(await workspace.timeline.getEvent(ownEvent)).not.toBeNull();
    expect(await workspace.timeline.getEvent(otherEvent)).toBeNull();
    await expect(workspace.requireMembership('admin')).rejects.toThrow('Requires admin role');
    expect(await scope.getItem()).toBe('visible');
    await expect(scope.updateItem()).rejects.toThrow('read-only');
    await expect(
      operatorDatabase(db).update(users).set({ name: 'forbidden' }).where(eq(users.id, MEMBER)),
    ).rejects.toThrow('read-only');
    await expect(
      guardOperatorScope(db, OTHER, MEMBER, {
        getItem: () => Promise.resolve('wrong team'),
      }).getItem(),
    ).rejects.toThrow('restricted');
    await expect(tagOperatorJob({ teamId: TEAM })).rejects.toThrow();
  });
  it('rechecks impersonation before executing an attributed job', async () => {
    const { token } = await startImpersonation(db, actor, input);
    const { session } = await resolveImpersonation(db, actor, token);
    const data = { teamId: TEAM, userId: MEMBER, platformOperatorSessionId: session.id };
    expect(await runGuardedJob(data, () => Promise.resolve('executed'), db)).toBe('executed');
    await expect(
      runGuardedJob({ ...data, userId: ADMIN }, () => Promise.resolve('bad'), db),
    ).rejects.toThrow();
    await endImpersonation(db, ADMIN, token);
    await expect(
      runGuardedJob(data, () => Promise.resolve('must not execute'), db),
    ).rejects.toThrow();
  });
});
