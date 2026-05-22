'use server';

import {
  teamInvites,
  teamMembers,
  teams,
  telegramChatBindings,
  telegramUsers,
  telegramUserTeams,
} from '@timeline/db';
import {
  assertNotLastOwner,
  buildInboundEmail,
  randomSlugSuffix,
  randomToken,
  slugify,
  withTeam,
} from '@timeline/shared';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE, resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createTeamSchema = z.object({ name: z.string().min(1).max(80) });

export interface CreateTeamState {
  error?: string;
}

export async function createTeamAction(
  _prev: CreateTeamState,
  formData: FormData,
): Promise<CreateTeamState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };

  const parsed = createTeamSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return { error: 'Invalid team name' };

  const baseSlug = slugify(parsed.data.name) || 'team';
  const slug = `${baseSlug}-${randomSlugSuffix()}`;
  const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
  let teamId: string;
  try {
    teamId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(teams)
        .values({ name: parsed.data.name, slug, inboundEmail })
        .returning({ id: teams.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error('insert teams returned nothing');
      await tx.insert(teamMembers).values({
        teamId: id,
        userId: session.user.id,
        role: 'owner',
      });
      return id;
    });
  } catch {
    return { error: 'Failed to create team' };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/app');
  redirect('/app/timeline');
}

const inviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(['admin', 'member']).default('member'),
});

export interface InviteState {
  error?: string;
  inviteUrl?: string;
}

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) return { error: 'Invalid email' };

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return { error: 'Only admins can invite' };
  }

  const token = randomToken(24);
  await db.insert(teamInvites).values({
    teamId: active.teamId,
    email: parsed.data.email,
    role: parsed.data.role,
    token,
    invitedByUserId: session.user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  const baseUrl = process.env.AUTH_URL ?? 'http://localhost:3000';
  const inviteUrl = `${baseUrl}/accept-invite/${token}`;
  revalidatePath('/app/team');
  return { inviteUrl };
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const memberUserId = formData.get('userId');
  if (typeof memberUserId !== 'string') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  const callerRole = await scope.requireMembership('admin');
  if (memberUserId === session.user.id) return;

  try {
    await db.transaction(async (tx) => {
      const targetRows = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)))
        .limit(1);
      const targetRole = targetRows[0]?.role;
      if (!targetRole) return;
      // Admins cannot remove owners; only another owner can.
      if (targetRole === 'owner' && callerRole !== 'owner') return;
      // Never strand a team with zero owners. `assertNotLastOwner` runs
      // SELECT FOR UPDATE on the team's owner rows so a concurrent removal
      // of a different owner cannot also pass this check.
      if (targetRole === 'owner') {
        await assertNotLastOwner(tx, active.teamId, memberUserId);
      }
      await tx
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)));

      // Revoke Telegram routing for this user — two anchors, both needed:
      //
      //   1. Consumer-side: telegram_users.user_id points at this app
      //      user (bound at /link time, after the username-match identity
      //      check). Any telegram_user_teams row keyed by such a
      //      telegram_users.id is *their* DM. This is the primary anchor.
      //   2. Provenance-side: rows where linked_by_user_id matches —
      //      catches edge cases like a teammate consuming an admin's token
      //      under a different TG account (rejected at consumption now,
      //      but the historical cleanup stays as defense in depth).
      //
      // Also drop group bindings they personally established.
      const ownedTgUserIds = await tx
        .select({ id: telegramUsers.id })
        .from(telegramUsers)
        .where(eq(telegramUsers.userId, memberUserId));
      const ownedIds = ownedTgUserIds.map((r) => r.id);

      // Snapshot the TG users whose active-team row is about to be deleted.
      // After the deletes we'll promote a remaining linked team to active
      // for each, so a DM author isn't left in a "linked but no active
      // team" state when they had other teams linked.
      const deactivationCandidates = await tx
        .select({ telegramUserId: telegramUserTeams.telegramUserId })
        .from(telegramUserTeams)
        .where(
          and(
            eq(telegramUserTeams.teamId, active.teamId),
            eq(telegramUserTeams.isActive, true),
            or(
              ownedIds.length > 0
                ? inArray(telegramUserTeams.telegramUserId, ownedIds)
                : sql`false`,
              eq(telegramUserTeams.linkedByUserId, memberUserId),
            ),
          ),
        );
      const affectedTgIds = Array.from(
        new Set(deactivationCandidates.map((r) => r.telegramUserId)),
      );

      if (ownedIds.length > 0) {
        await tx
          .delete(telegramUserTeams)
          .where(
            and(
              eq(telegramUserTeams.teamId, active.teamId),
              inArray(telegramUserTeams.telegramUserId, ownedIds),
            ),
          );
      }
      await tx
        .delete(telegramUserTeams)
        .where(
          and(
            eq(telegramUserTeams.teamId, active.teamId),
            eq(telegramUserTeams.linkedByUserId, memberUserId),
          ),
        );
      await tx
        .delete(telegramChatBindings)
        .where(
          and(
            eq(telegramChatBindings.teamId, active.teamId),
            eq(telegramChatBindings.boundByUserId, memberUserId),
          ),
        );

      // For each TG user that just lost its active routing row, promote
      // the oldest remaining linked team to active. Skip if another active
      // row somehow survived (paranoia) or if they have no remaining
      // links at all.
      for (const tgUserId of affectedTgIds) {
        const remaining = await tx
          .select({ id: telegramUserTeams.id, isActive: telegramUserTeams.isActive })
          .from(telegramUserTeams)
          .where(eq(telegramUserTeams.telegramUserId, tgUserId))
          .orderBy(asc(telegramUserTeams.createdAt), asc(telegramUserTeams.id));
        const oldest = remaining[0];
        if (!oldest) continue;
        if (remaining.some((r) => r.isActive)) continue;
        await tx
          .update(telegramUserTeams)
          .set({ isActive: true })
          .where(eq(telegramUserTeams.id, oldest.id));
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'last_owner') return;
    throw e;
  }
  revalidatePath('/app/team');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const changeRoleSchema = z.object({
  userId: z.string().regex(UUID_RE),
  role: z.enum(['owner', 'admin', 'member']),
});

export interface ChangeMemberRoleState {
  error?: string;
}

/**
 * Change a member's role within the active team. Only owners can promote
 * to or demote from `owner`. Demoting an owner is blocked when they are
 * the last owner (assertNotLastOwner) so a team can never reach zero
 * owners through normal flows — use transferOwnershipAction for that.
 */
export async function changeMemberRoleAction(
  _prev: ChangeMemberRoleState,
  formData: FormData,
): Promise<ChangeMemberRoleState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };
  const parsed = changeRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) return { error: 'Invalid input' };

  const scope = withTeam(db, active.teamId, session.user.id);
  let callerRole: 'owner' | 'admin' | 'member';
  try {
    callerRole = await scope.requireMembership('admin');
  } catch {
    return { error: 'Not authorized' };
  }

  try {
    await db.transaction(async (tx) => {
      const target = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, parsed.data.userId)))
        .limit(1);
      const targetRole = target[0]?.role;
      if (!targetRole) throw new Error('not_a_member');
      if (targetRole === parsed.data.role) return;
      // Only owners may promote-to or demote-from owner.
      if ((targetRole === 'owner' || parsed.data.role === 'owner') && callerRole !== 'owner') {
        throw new Error('forbidden');
      }
      // Demoting an owner must leave at least one owner remaining.
      if (targetRole === 'owner' && parsed.data.role !== 'owner') {
        await assertNotLastOwner(tx, active.teamId, parsed.data.userId);
      }
      await tx
        .update(teamMembers)
        .set({ role: parsed.data.role })
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, parsed.data.userId)));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg === 'last_owner') return { error: 'Cannot demote the last owner' };
    if (msg === 'forbidden') return { error: 'Only owners can change owner roles' };
    if (msg === 'not_a_member') return { error: 'Not a member' };
    return { error: 'Failed to change role' };
  }
  revalidatePath('/app/team');
  return {};
}

const transferSchema = z.object({
  targetUserId: z.string().regex(UUID_RE),
  /** When true, the caller is demoted to admin after the transfer. */
  stepDown: z.coerce.boolean().optional(),
});

export interface TransferOwnershipState {
  error?: string;
}

/**
 * Promote `targetUserId` to owner. Optionally demote the caller to admin
 * in the same transaction (stepDown=true). The whole swap is atomic, so
 * a crash mid-flight can't strand the team with zero owners.
 */
export async function transferOwnershipAction(
  _prev: TransferOwnershipState,
  formData: FormData,
): Promise<TransferOwnershipState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return { error: 'No active team' };
  const parsed = transferSchema.safeParse({
    targetUserId: formData.get('targetUserId'),
    stepDown: formData.get('stepDown') ?? undefined,
  });
  if (!parsed.success) return { error: 'Invalid input' };
  if (parsed.data.targetUserId === session.user.id) return { error: 'Cannot transfer to self' };

  const scope = withTeam(db, active.teamId, session.user.id);
  let callerRole: 'owner' | 'admin' | 'member';
  try {
    callerRole = await scope.requireMembership('owner');
  } catch {
    return { error: 'Only owners can transfer ownership' };
  }
  if (callerRole !== 'owner') return { error: 'Only owners can transfer ownership' };

  try {
    await db.transaction(async (tx) => {
      // Lock the owner set so a concurrent transfer can't violate the
      // one-owner-minimum invariant. Also re-verify the caller is still an
      // owner inside the lock — requireMembership() ran before the tx and
      // could be stale if another admin demoted the caller in between.
      const ownerRows = await tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.role, 'owner')))
        .for('update');
      if (!ownerRows.some((r) => r.userId === session.user.id)) {
        throw new Error('forbidden');
      }

      const target = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, parsed.data.targetUserId)),
        )
        .limit(1);
      if (!target[0]) throw new Error('not_a_member');

      await tx
        .update(teamMembers)
        .set({ role: 'owner' })
        .where(
          and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, parsed.data.targetUserId)),
        );
      if (parsed.data.stepDown) {
        await tx
          .update(teamMembers)
          .set({ role: 'admin' })
          .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, session.user.id)));
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    if (msg === 'not_a_member') return { error: 'Target is not a member' };
    if (msg === 'forbidden') return { error: 'Only owners can transfer ownership' };
    return { error: 'Failed to transfer ownership' };
  }
  revalidatePath('/app/team');
  return {};
}
