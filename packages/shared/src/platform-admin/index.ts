import { createHash, randomBytes } from 'node:crypto';

import {
  platformAdminAudit,
  platformImpersonationSessions,
  teamBillingAccounts,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { isPlatformAdminEmail } from '#src/billing/operator.js';
import { getEnv } from '#src/env.js';

export const IMPERSONATION_COOKIE = 'tl_platform_impersonation';
export interface PlatformActor {
  userId: string;
  email: string;
}
export class PlatformAccessError extends Error {}
export async function requirePlatformActor(db: Db, actor: PlatformActor) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(eq(users.id, actor.userId));
  if (
    !user?.emailVerified ||
    user.suspendedAt ||
    user.email.toLowerCase() !== actor.email.trim().toLowerCase() ||
    !isPlatformAdminEmail(user.email, getEnv().PLATFORM_ADMIN_EMAILS)
  ) {
    throw new PlatformAccessError('Platform administrator access required');
  }
  return user;
}
export async function recordPlatformAudit(db: Db, event: typeof platformAdminAudit.$inferInsert) {
  await db.insert(platformAdminAudit).values(event);
}
const userFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  createdAt: users.createdAt,
  suspendedAt: users.suspendedAt,
};
const teamFields = {
  id: teams.id,
  name: teams.name,
  slug: teams.slug,
  createdAt: teams.createdAt,
  securityState: teamBillingAccounts.securityState,
  billingState: teamBillingAccounts.billingState,
  planId: teamBillingAccounts.planId,
};
export function directoryPage(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100000) : 1;
}
function searchTerm(value: string) {
  return `%${value
    .trim()
    .slice(0, 200)
    .replace(/[\\%_]/g, '\\$&')}%`;
}
export async function listPlatformUsers(db: Db, actor: PlatformActor, query: string, page: number) {
  await requirePlatformActor(db, actor);
  await recordPlatformAudit(db, { actorUserId: actor.userId, action: 'directory.users.read' });
  const filter = or(
    ilike(users.email, searchTerm(query)),
    ilike(users.name, searchTerm(query)),
    ilike(sql`${users.id}::text`, searchTerm(query)),
  );
  const [rows, total] = await Promise.all([
    db
      .select({
        ...userFields,
        membershipCount: sql<number>`(select count(*)::int from team_members where user_id = ${users.id} and removed_at is null)`,
      })
      .from(users)
      .where(filter)
      .orderBy(desc(users.createdAt), users.id)
      .limit(50)
      .offset((directoryPage(page) - 1) * 50),
    db.select({ value: count() }).from(users).where(filter),
  ]);
  return { rows, total: total[0]?.value ?? 0 };
}
export async function listPlatformTeams(db: Db, actor: PlatformActor, query: string, page: number) {
  await requirePlatformActor(db, actor);
  await recordPlatformAudit(db, { actorUserId: actor.userId, action: 'directory.teams.read' });
  const filter = or(
    ilike(teams.name, searchTerm(query)),
    ilike(teams.slug, searchTerm(query)),
    ilike(sql`${teams.id}::text`, searchTerm(query)),
  );
  const [rows, total] = await Promise.all([
    db
      .select({
        ...teamFields,
        memberCount: sql<number>`(select count(*)::int from team_members where team_id = ${teams.id} and removed_at is null)`,
      })
      .from(teams)
      .leftJoin(teamBillingAccounts, eq(teams.id, teamBillingAccounts.teamId))
      .where(filter)
      .orderBy(desc(teams.createdAt), teams.id)
      .limit(50)
      .offset((directoryPage(page) - 1) * 50),
    db.select({ value: count() }).from(teams).where(filter),
  ]);
  return { rows, total: total[0]?.value ?? 0 };
}
export async function readPlatformUser(db: Db, actor: PlatformActor, id: string) {
  await requirePlatformActor(db, actor);
  z.uuid().parse(id);
  await recordPlatformAudit(db, {
    actorUserId: actor.userId,
    action: 'directory.user.read',
    targetId: id,
  });
  const [user] = await db.select(userFields).from(users).where(eq(users.id, id));
  const memberships = await db
    .select({
      teamId: teams.id,
      name: teams.name,
      role: teamMembers.role,
      removedAt: teamMembers.removedAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, id))
    .orderBy(teams.name);
  return user
    ? {
        ...user,
        memberships,
        canSuspend:
          id !== actor.userId && !isPlatformAdminEmail(user.email, getEnv().PLATFORM_ADMIN_EMAILS),
      }
    : null;
}
export async function readPlatformTeam(db: Db, actor: PlatformActor, id: string) {
  await requirePlatformActor(db, actor);
  z.uuid().parse(id);
  await recordPlatformAudit(db, {
    actorUserId: actor.userId,
    action: 'directory.team.read',
    targetId: id,
  });
  const [team] = await db
    .select(teamFields)
    .from(teams)
    .leftJoin(teamBillingAccounts, eq(teams.id, teamBillingAccounts.teamId))
    .where(eq(teams.id, id));
  const members = await db
    .select({ ...userFields, role: teamMembers.role, removedAt: teamMembers.removedAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, id))
    .orderBy(users.email);
  return team ? { ...team, members } : null;
}
export async function listPlatformAudit(db: Db, actor: PlatformActor, page: number) {
  await requirePlatformActor(db, actor);
  return db
    .select({
      id: platformAdminAudit.id,
      action: platformAdminAudit.action,
      actorUserId: platformAdminAudit.actorUserId,
      effectiveUserId: platformAdminAudit.effectiveUserId,
      teamId: platformAdminAudit.teamId,
      sessionId: platformAdminAudit.sessionId,
      reason: platformAdminAudit.reason,
      metadata: platformAdminAudit.metadata,
      createdAt: platformAdminAudit.createdAt,
      actorEmail: users.email,
    })
    .from(platformAdminAudit)
    .innerJoin(users, eq(users.id, platformAdminAudit.actorUserId))
    .orderBy(desc(platformAdminAudit.createdAt), platformAdminAudit.id)
    .limit(51)
    .offset((directoryPage(page) - 1) * 50);
}
export async function renamePlatformEntity(
  db: Db,
  actor: PlatformActor,
  kind: 'user' | 'team',
  id: string,
  name: string,
) {
  z.uuid().parse(id);
  name = z
    .string()
    .trim()
    .min(1)
    .max(kind === 'team' ? 80 : 120)
    .parse(name);
  await db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    const table = kind === 'user' ? users : teams;
    const [before] = await tx
      .select({ name: table.name })
      .from(table)
      .where(eq(table.id, id))
      .for('update');
    if (!before) throw new PlatformAccessError('Record not found');
    await tx.update(table).set({ name }).where(eq(table.id, id));
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      action: `${kind}.rename`,
      targetId: id,
      metadata: { fields: ['name'] },
    });
  });
}
export async function setPlatformSuspension(
  db: Db,
  actor: PlatformActor,
  kind: 'user' | 'team',
  id: string,
  suspended: boolean,
  reason: string,
) {
  z.uuid().parse(id);
  reason = z.string().trim().min(3).max(1000).parse(reason);
  await db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    if (kind === 'user') {
      const [target] = await tx
        .select(userFields)
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      if (!target) throw new PlatformAccessError('User not found');
      if (
        suspended &&
        (id === actor.userId || isPlatformAdminEmail(target.email, getEnv().PLATFORM_ADMIN_EMAILS))
      )
        throw new PlatformAccessError('Platform administrators cannot be suspended here');
      await tx
        .update(users)
        .set({
          suspendedAt: suspended ? new Date() : null,
          suspensionReason: suspended ? reason : null,
        })
        .where(eq(users.id, id));
    } else {
      const [team] = await tx.select().from(teams).where(eq(teams.id, id)).for('update');
      if (!team) throw new PlatformAccessError('Team not found');
      // Billing scope creates accounts with the current catalog defaults.
      const { withTeam } = await import('#src/team-scope.js');
      const existing = await tx
        .select({ teamId: teamBillingAccounts.teamId })
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, id));
      if (!existing.length)
        await withTeam(store, id, actor.userId, { skipMembershipCheck: true }).billing.getAccount();
      const [account] = await tx
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, id))
        .for('update');
      if (!account || account.securityState === 'terminated')
        throw new PlatformAccessError('Team cannot be restored here');
      if (suspended && account.securityState !== 'suspended') {
        await tx
          .update(teams)
          .set({ suspensionPreviousState: account.securityState })
          .where(eq(teams.id, id));
        await tx
          .update(teamBillingAccounts)
          .set({ securityState: 'suspended' })
          .where(eq(teamBillingAccounts.teamId, id));
      } else if (!suspended && account.securityState === 'suspended') {
        if (!team.suspensionPreviousState)
          throw new PlatformAccessError(
            'This suspension must be restored by its originating security workflow',
          );
        const previous = z
          .enum(['normal', 'challenged', 'restricted'])
          .parse(team.suspensionPreviousState);
        await tx
          .update(teamBillingAccounts)
          .set({ securityState: previous })
          .where(eq(teamBillingAccounts.teamId, id));
        await tx.update(teams).set({ suspensionPreviousState: null }).where(eq(teams.id, id));
      }
    }
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      action: `${kind}.${suspended ? 'suspend' : 'restore'}`,
      targetId: id,
      teamId: kind === 'team' ? id : null,
      reason,
    });
  });
}

const accessInput = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  purpose: z.string().trim().min(3).max(1000),
  reference: z.string().trim().min(1).max(200),
  authorization: z.string().trim().min(3).max(1000),
});
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function startImpersonation(
  db: Db,
  actor: PlatformActor,
  raw: z.input<typeof accessInput>,
) {
  const input = accessInput.parse(raw);
  if (input.userId === actor.userId) throw new PlatformAccessError('Choose another user');
  return db.transaction(async (tx) => {
    const store = tx as unknown as Db;
    await requirePlatformActor(store, actor);
    const [member] = await tx
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.userId),
          isNull(teamMembers.removedAt),
        ),
      )
      .for('update');
    if (!member) throw new PlatformAccessError('Active membership required');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const [session] = await tx
      .insert(platformImpersonationSessions)
      .values({
        tokenHash: tokenHash(token),
        actorUserId: actor.userId,
        effectiveUserId: input.userId,
        teamId: input.teamId,
        authorizationEpoch: member.authorizationEpoch,
        purpose: input.purpose,
        reference: input.reference,
        authorization: input.authorization,
        expiresAt,
      })
      .returning();
    if (!session) throw new Error('Could not create impersonation session');
    await recordPlatformAudit(store, {
      actorUserId: actor.userId,
      effectiveUserId: input.userId,
      teamId: input.teamId,
      sessionId: session.id,
      action: 'impersonation.start',
      reason: input.purpose,
      metadata: {
        reference: input.reference,
        authorization: input.authorization,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return { token, expiresAt };
  });
}
export async function endImpersonation(
  db: Db,
  actorUserId: string,
  token: string,
  action = 'impersonation.end',
) {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .update(platformImpersonationSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(platformImpersonationSessions.tokenHash, tokenHash(token)),
          eq(platformImpersonationSessions.actorUserId, actorUserId),
          isNull(platformImpersonationSessions.endedAt),
        ),
      )
      .returning();
    if (session)
      await recordPlatformAudit(tx as unknown as Db, {
        actorUserId,
        effectiveUserId: session.effectiveUserId,
        teamId: session.teamId,
        sessionId: session.id,
        action,
      });
  });
}
export async function resolveImpersonation(
  db: Db,
  actor: PlatformActor,
  token: string,
  hashed = false,
) {
  await requirePlatformActor(db, actor);
  const [session] = await db
    .select()
    .from(platformImpersonationSessions)
    .where(
      and(
        eq(platformImpersonationSessions.tokenHash, hashed ? token : tokenHash(token)),
        eq(platformImpersonationSessions.actorUserId, actor.userId),
        isNull(platformImpersonationSessions.endedAt),
      ),
    );
  if (!session) throw new PlatformAccessError('Impersonation session is invalid');
  if (session.expiresAt <= new Date()) {
    await endImpersonation(db, actor.userId, token, 'impersonation.expire');
    throw new PlatformAccessError('Impersonation session expired');
  }
  const [member] = await db
    .select({ role: teamMembers.role, epoch: teamMembers.authorizationEpoch })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, session.teamId),
        eq(teamMembers.userId, session.effectiveUserId),
        isNull(teamMembers.removedAt),
      ),
    );
  if (member?.epoch !== session.authorizationEpoch)
    throw new PlatformAccessError('Impersonation membership changed');
  const [user] = await db
    .select(userFields)
    .from(users)
    .where(eq(users.id, session.effectiveUserId));
  if (!user) throw new PlatformAccessError('User no longer exists');
  const [team] = await db
    .select({ name: teams.name, securityState: teamBillingAccounts.securityState })
    .from(teams)
    .leftJoin(teamBillingAccounts, eq(teams.id, teamBillingAccounts.teamId))
    .where(eq(teams.id, session.teamId));
  if (!team) throw new PlatformAccessError('Team no longer exists');
  return {
    session,
    user,
    role: member.role,
    teamName: team.name,
    readOnly:
      user.suspendedAt !== null ||
      team.securityState === 'suspended' ||
      team.securityState === 'terminated',
  };
}
