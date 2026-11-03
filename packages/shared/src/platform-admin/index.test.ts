import { PGlite } from '@electric-sql/pglite';
import {
  auditLog,
  platformAdminAudit,
  platformImpersonationSessions,
  users,
  type Db,
} from '@timeline/db';
import { expect, vi } from '@timeline/test-support';
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
  placePlatformRetentionHold,
  releasePlatformRetentionHold,
  prunePlatformAdminRecords,
} from '#src/platform-admin/retention.js';
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
  it('bounds each retention sweep and preserves sessions still inside the retention window', async () => {
    await startImpersonation(db, actor, input);
    await pg.exec(`UPDATE platform_impersonation_sessions SET expires_at = now() - interval '29 days';
      INSERT INTO platform_admin_audit (actor_user_id,action,created_at) SELECT '${ADMIN}','old-batch',now() - interval '13 months' FROM generate_series(1,501);`);
    expect(await prunePlatformAdminRecords(db)).toEqual({
      sessionsDeleted: 0,
      auditRecordsDeleted: 500,
      releasedHoldsDeleted: 0,
    });
    expect((await prunePlatformAdminRecords(db)).auditRecordsDeleted).toBe(1);
  });
  it('deletes only ended or expired sessions beyond 30 days and audits beyond 12 months', async () => {
    await startImpersonation(db, actor, input);
    await pg.exec(`UPDATE platform_impersonation_sessions SET expires_at = now() - interval '31 days';
      INSERT INTO platform_admin_audit (actor_user_id,action,created_at) VALUES ('${ADMIN}','old',now() - interval '13 months'),('${ADMIN}','recent',now() - interval '11 months');`);
    expect(await prunePlatformAdminRecords(db)).toEqual({
      sessionsDeleted: 1,
      auditRecordsDeleted: 1,
      releasedHoldsDeleted: 0,
    });
    await startImpersonation(db, actor, input);
    expect((await prunePlatformAdminRecords(db)).sessionsDeleted).toBe(0);
    await pg.exec(
      `UPDATE platform_impersonation_sessions SET ended_at = now() - interval '31 days'`,
    );
    expect((await prunePlatformAdminRecords(db)).sessionsDeleted).toBe(1);
    expect(
      (await db.select().from(platformAdminAudit)).some((row) => row.action === 'recent'),
    ).toBe(true);
  });
  it('preserves held records, audits hold changes, and deletes after release', async () => {
    await startImpersonation(db, actor, input);
    await pg.exec(`UPDATE platform_impersonation_sessions SET expires_at = now() - interval '31 days';
      INSERT INTO platform_admin_audit (actor_user_id,team_id,action,created_at) VALUES ('${ADMIN}','${TEAM}','held',now() - interval '13 months');`);
    const hold = await placePlatformRetentionHold(db, actor, {
      kind: 'team',
      id: TEAM,
      reason: 'Documented preservation request',
      reference: 'LEGAL-1',
    });
    expect(await prunePlatformAdminRecords(db)).toEqual({
      sessionsDeleted: 0,
      auditRecordsDeleted: 0,
      releasedHoldsDeleted: 0,
    });
    await expect(pg.exec("DELETE FROM platform_admin_audit WHERE action = 'held'")).rejects.toThrow(
      'append-only',
    );
    await releasePlatformRetentionHold(db, actor, hold.id, 'Legal owner authorized release');
    expect(await prunePlatformAdminRecords(db)).toEqual({
      sessionsDeleted: 1,
      auditRecordsDeleted: 1,
      releasedHoldsDeleted: 0,
    });
    expect(
      (await db.select().from(platformAdminAudit)).filter((row) =>
        row.action.startsWith('retention.hold.'),
      ).length,
    ).toBe(2);
    await pg.exec(
      `UPDATE platform_admin_retention_holds SET released_at = now() - interval '13 months'`,
    );
    expect((await prunePlatformAdminRecords(db)).releasedHoldsDeleted).toBe(1);
  });
  it('protects user-targeted audit records under holds and rejects ordinary hold operators', async () => {
    await expect(
      placePlatformRetentionHold(
        db,
        { userId: MEMBER, email: 'member@example.test' },
        { kind: 'user', id: MEMBER, reason: 'Not authorized', reference: 'LEGAL-2' },
      ),
    ).rejects.toThrow();
    await pg.exec(
      `INSERT INTO platform_admin_audit (actor_user_id,target_id,action,created_at) VALUES ('${ADMIN}','${MEMBER}','user-history',now() - interval '13 months');`,
    );
    await placePlatformRetentionHold(db, actor, {
      kind: 'user',
      id: MEMBER,
      reason: 'User preservation request',
      reference: 'LEGAL-2',
    });
    expect((await prunePlatformAdminRecords(db)).auditRecordsDeleted).toBe(0);
    await expect(
      pg.exec("UPDATE platform_admin_audit SET reason = 'tampered' WHERE action = 'user-history'"),
    ).rejects.toThrow('append-only');
  });
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
  it('installs one wrapper on the underlying method so later replacements intercept it', async () => {
    const objects = {
      setTaskProject: (id: string) => Promise.resolve(`orig:${id}`),
    };
    const scope = guardOperatorScope(db, TEAM, MEMBER, { objects });
    expect(scope.objects).toBe(scope.objects);
    expect(scope.objects.setTaskProject).toBe(objects.setTaskProject);
    let intercepted = false;
    const current = objects.setTaskProject;
    objects.setTaskProject = (id: string) => {
      intercepted = true;
      return current(id);
    };
    expect(await scope.objects.setTaskProject('task-1')).toBe('orig:task-1');
    expect(intercepted).toBe(true);
    const spy = vi.spyOn(scope.objects, 'setTaskProject');
    await scope.objects.setTaskProject('task-2');
    expect(spy).toHaveBeenCalledWith('task-2');
    spy.mockRestore();
  });

  it('rechecks suspension on each operation even when reusing a team scope', async () => {
    const { withTeam } = await import('#src/team-scope.js');
    const scope = withTeam(db, TEAM, MEMBER);
    expect((await scope.timeline.team())?.id).toBe(TEAM);
    await setPlatformSuspension(db, actor, 'user', MEMBER, true, 'suspend between operations');
    await expect(scope.timeline.team()).rejects.toThrow('Account is suspended');
  });
  it('still checks suspension when the first scoped operation uses a transaction client', async () => {
    const { withTeam } = await import('#src/team-scope.js');
    await setPlatformSuspension(db, actor, 'user', MEMBER, true, 'suspend before tx scope');
    await expect(
      db.transaction(async (tx) => {
        const txScope = withTeam(tx as unknown as Db, TEAM, MEMBER);
        return txScope.timeline.team();
      }),
    ).rejects.toThrow('Account is suspended');
    await setPlatformSuspension(db, actor, 'user', MEMBER, false, 'restore before team suspension');
    await setPlatformSuspension(db, actor, 'team', TEAM, true, 'suspend workspace before tx scope');
    await expect(
      db.transaction(async (tx) => {
        const txScope = withTeam(tx as unknown as Db, TEAM, MEMBER);
        return txScope.timeline.team();
      }),
    ).rejects.toThrow('Workspace is suspended');
  });
  it('reuses verified admission inside a nested transaction scope', async () => {
    const { withTeam } = await import('#src/team-scope.js');
    const nested = {
      work: async () =>
        db.transaction(async (tx) => {
          const txScope = withTeam(tx as unknown as Db, TEAM, MEMBER);
          return (await txScope.timeline.team())?.id;
        }),
    };
    const scope = guardOperatorScope(db, TEAM, MEMBER, nested);
    expect(await scope.work()).toBe(TEAM);
    await setPlatformSuspension(db, actor, 'user', MEMBER, true, 'suspend after nested tx');
    await expect(scope.work()).rejects.toThrow('Account is suspended');
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
    expect((await workspace.timeline.team())?.id).toBe(TEAM);
    expect(await workspace.objects.unreadNotificationCount()).toBe(0);
    expect(await workspace.timeline.getEvent(otherEvent)).toBeNull();
    expect(await workspace.timeline.getEventWithFacts(ownEvent)).not.toBeNull();
    const documentId = crypto.randomUUID();
    await pg.exec(
      `INSERT INTO documents (id,team_id,name,visibility,owner_user_id) VALUES ('${documentId}','${TEAM}','private.pdf','private','${MEMBER}')`,
    );
    expect(await workspace.documents.getDocument(documentId)).not.toBeNull();
    const reads = await db.select({ action: auditLog.action }).from(auditLog);
    expect(reads.map((row) => row.action)).toContain('document.detail_read');
    expect(reads.map((row) => row.action)).toContain('event.detail_read');
    await expect(
      operatorDatabase(db)
        .insert(auditLog)
        .values({ teamId: TEAM, action: 'document.visibility_change', targetType: 'document' }),
    ).rejects.toThrow('read-only');
    await expect(operatorDatabase(db).update(auditLog).set({ metadata: {} })).rejects.toThrow(
      'read-only',
    );
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
  it('retains document attribution when recovery reconstructs a job after operator exit', async () => {
    const { token } = await startImpersonation(db, actor, input);
    const { session } = await resolveImpersonation(db, actor, token);
    registerOperatorContextResolver(() =>
      Promise.resolve({
        actorUserId: ADMIN,
        actorEmail: actor.email,
        effectiveUserId: MEMBER,
        teamId: TEAM,
        sessionId: session.id,
        readOnly: false,
      }),
    );
    const { withTeam } = await import('#src/team-scope.js');
    const scope = withTeam(db, TEAM, MEMBER).documents;
    const created = await scope.createDocument({
      name: 'recovery.pdf',
      filename: 'recovery.pdf',
      contentType: 'application/pdf',
      folderId: null,
    });
    await scope.finalizeDocumentVersion({
      versionId: created.version.id,
      byteSize: 10,
      contentType: 'application/pdf',
    });
    registerOperatorContextResolver(() => Promise.resolve(null));
    const recovered = { teamId: TEAM, documentVersionId: created.version.id };
    expect(await runGuardedJob(recovered, () => Promise.resolve('authorized'), db)).toBe(
      'authorized',
    );
    await endImpersonation(db, ADMIN, token);
    let executed = false;
    await expect(
      runGuardedJob(
        recovered,
        () => {
          executed = true;
          return Promise.resolve();
        },
        db,
      ),
    ).rejects.toThrow('authorization expired');
    expect(executed).toBe(false);
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
