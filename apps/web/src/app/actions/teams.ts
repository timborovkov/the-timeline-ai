'use server';

import {
  integrations,
  teamInvites,
  teamMembers,
  teamVisibilityDefaults,
  teams,
  telegramChatBindings,
  telegramUsers,
  telegramUserTeams,
  users,
} from '@timeline/db';
import {
  assertNotLastOwner,
  buildInboundEmail,
  randomSlugSuffix,
  randomToken,
  sendTeamInviteEmail,
  slugify,
  withTeam,
} from '@timeline/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE, resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createTeamSchema = z.object({ name: z.string().min(1).max(80) });
const renameTeamSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

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

export interface RenameTeamState {
  error?: string;
  ok?: boolean;
}

export async function renameTeamAction(
  _prev: RenameTeamState,
  formData: FormData,
): Promise<RenameTeamState> {
  const session = await auth();
  if (!session?.user) return { error: 'Not signed in' };

  const parsed = renameTeamSchema.safeParse({
    teamId: formData.get('teamId'),
    name: formData.get('name'),
  });
  if (!parsed.success) return { error: 'Invalid team name' };

  const scope = withTeam(db, parsed.data.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    return { error: 'Only admins can rename a team' };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(teams)
        .set({ name: parsed.data.name })
        .where(eq(teams.id, parsed.data.teamId));
      await tx.insert(auditLog).values({
        teamId: parsed.data.teamId,
        actorUserId: session.user.id,
        action: 'settings.change',
        targetType: 'team',
        targetId: parsed.data.teamId,
        targetVisibility: 'team',
        metadata: { setting: 'team.name' },
      });
    });
  } catch {
    return { error: 'Failed to rename team' };
  }

  revalidatePath('/app', 'layout');
  revalidatePath('/app/team');
  return { ok: true };
}

const inviteSchema = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(['admin', 'member']).default('member'),
});

export interface InviteState {
  error?: string;
  inviteUrl?: string;
  sendStatus?: 'pending' | 'sent' | 'failed';
  sendError?: string;
}

interface InviteDeliveryInput {
  id: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  expiresAt: Date;
  teamName: string;
  inviterName: string;
}

function inviteUrl(token: string): string {
  const baseUrl = process.env.AUTH_URL ?? 'http://localhost:3000';
  return `${baseUrl}/accept-invite/${token}`;
}

async function deliverInviteEmail(input: InviteDeliveryInput): Promise<InviteState> {
  const url = inviteUrl(input.token);
  const result = await sendTeamInviteEmail({
    to: input.email,
    inviterName: input.inviterName,
    teamName: input.teamName,
    role: input.role,
    inviteUrl: url,
    expiresAt: input.expiresAt,
  });
  if (result.ok) {
    await db
      .update(teamInvites)
      .set({ sendStatus: 'sent', sendError: null, lastSentAt: new Date() })
      .where(eq(teamInvites.id, input.id));
    return { inviteUrl: url, sendStatus: 'sent' };
  }
  const sendError = result.error ?? 'Failed to send invite email';
  await db
    .update(teamInvites)
    .set({ sendStatus: 'failed', sendError, lastSentAt: new Date() })
    .where(eq(teamInvites.id, input.id));
  return { inviteUrl: url, sendStatus: 'failed', sendError };
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
  let callerRole: 'owner' | 'admin' | 'member';
  try {
    callerRole = await scope.requireMembership('admin');
    if (parsed.data.role === 'admin' && callerRole !== 'owner') {
      return { error: 'Only owners can invite admins' };
    }
  } catch {
    return { error: 'Only admins can invite' };
  }

  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const inviterName = session.user.name ?? session.user.email ?? 'A teammate';
  let delivery: InviteDeliveryInput;
  try {
    delivery = await db.transaction(async (tx) => {
      const activeMembers = await tx
        .select({ userId: teamMembers.userId })
        .from(users)
        .innerJoin(teamMembers, eq(teamMembers.userId, users.id))
        .where(
          and(
            eq(teamMembers.teamId, active.teamId),
            isNull(teamMembers.removedAt),
            sql`lower(${users.email}) = ${parsed.data.email}`,
          ),
        )
        .limit(1);
      if (activeMembers[0]) throw new Error('already-member');

      const openInvites = await tx
        .select({ id: teamInvites.id, role: teamInvites.role })
        .from(teamInvites)
        .where(
          and(
            eq(teamInvites.teamId, active.teamId),
            eq(teamInvites.email, parsed.data.email),
            isNull(teamInvites.acceptedAt),
            isNull(teamInvites.revokedAt),
          ),
        )
        .limit(1)
        .for('update');
      const existing = openInvites[0];
      if (existing?.role === 'admin' && callerRole !== 'owner') {
        throw new Error('admin-invite-owned-by-owner');
      }
      const rows = existing
        ? await tx
            .update(teamInvites)
            .set({
              role: parsed.data.role,
              token,
              invitedByUserId: session.user.id,
              expiresAt,
              sendStatus: 'pending',
              sendError: null,
              lastSentAt: null,
            })
            .where(eq(teamInvites.id, existing.id))
            .returning({ id: teamInvites.id })
        : await tx
            .insert(teamInvites)
            .values({
              teamId: active.teamId,
              email: parsed.data.email,
              role: parsed.data.role,
              token,
              invitedByUserId: session.user.id,
              expiresAt,
              sendStatus: 'pending',
            })
            .returning({ id: teamInvites.id });
      const id = rows[0]?.id;
      if (!id) throw new Error('invite-write-failed');
      await tx.insert(auditLog).values({
        teamId: active.teamId,
        actorUserId: session.user.id,
        action: 'settings.change',
        targetType: 'team',
        targetId: active.teamId,
        targetVisibility: 'team',
        metadata: {
          setting: existing ? 'team.invite_updated' : 'team.invite',
          inviteId: id,
          role: parsed.data.role,
        },
      });
      return {
        id,
        email: parsed.data.email,
        role: parsed.data.role,
        token,
        expiresAt,
        teamName: active.teamName,
        inviterName,
      };
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'already-member') {
      return { error: 'This person is already a member. Change their role from the members list.' };
    }
    if (err instanceof Error && err.message === 'admin-invite-owned-by-owner') {
      return { error: 'Only owners can change an admin invite for this email.' };
    }
    return { error: 'Failed to create invite' };
  }

  const result = await deliverInviteEmail(delivery);
  revalidatePath('/app/team');
  return result;
}

export async function resendInviteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const inviteId = formData.get('inviteId');
  if (typeof inviteId !== 'string') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  const callerRole = await scope.requireMembership('admin');
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const inviterName = session.user.name ?? session.user.email ?? 'A teammate';
  const delivery = await db.transaction(async (tx): Promise<InviteDeliveryInput | null> => {
    const rows = await tx
      .select({
        id: teamInvites.id,
        email: teamInvites.email,
        role: teamInvites.role,
      })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.id, inviteId),
          eq(teamInvites.teamId, active.teamId),
          isNull(teamInvites.acceptedAt),
          isNull(teamInvites.revokedAt),
        ),
      )
      .limit(1)
      .for('update');
    const invite = rows[0];
    if (!invite) return null;
    if (invite.role === 'owner') return null;
    if (invite.role === 'admin' && callerRole !== 'owner') return null;
    await tx
      .update(teamInvites)
      .set({ token, expiresAt, sendStatus: 'pending', sendError: null, lastSentAt: null })
      .where(eq(teamInvites.id, invite.id));
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token,
      expiresAt,
      teamName: active.teamName,
      inviterName,
    };
  });
  if (delivery) await deliverInviteEmail(delivery);
  revalidatePath('/app/team');
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const inviteId = formData.get('inviteId');
  if (typeof inviteId !== 'string') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  const callerRole = await scope.requireMembership('admin');
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ role: teamInvites.role })
      .from(teamInvites)
      .where(
        and(
          eq(teamInvites.id, inviteId),
          eq(teamInvites.teamId, active.teamId),
          isNull(teamInvites.acceptedAt),
          isNull(teamInvites.revokedAt),
        ),
      )
      .limit(1)
      .for('update');
    const invite = rows[0];
    if (!invite) return;
    if (invite.role === 'admin' && callerRole !== 'owner') return;
    await tx
      .update(teamInvites)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(eq(teamInvites.id, inviteId));
    await tx.insert(auditLog).values({
      teamId: active.teamId,
      actorUserId: session.user.id,
      action: 'settings.change',
      targetType: 'team',
      targetId: active.teamId,
      targetVisibility: 'team',
      metadata: { setting: 'team.invite_revoked', inviteId, role: invite.role },
    });
  });
  revalidatePath('/app/team');
}

export async function changeMemberRoleAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return;
  const memberUserId = formData.get('userId');
  const role = formData.get('role');
  if (typeof memberUserId !== 'string') return;
  if (role !== 'owner' && role !== 'admin' && role !== 'member') return;

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('owner');
  } catch {
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const targetRows = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, active.teamId),
            eq(teamMembers.userId, memberUserId),
            isNull(teamMembers.removedAt),
          ),
        )
        .limit(1)
        .for('update');
      const target = targetRows[0];
      if (!target) return;
      if (target.role === role) return;
      if (target.role === 'owner' && role !== 'owner') {
        await assertNotLastOwner(tx, active.teamId, memberUserId);
      }
      await tx
        .update(teamMembers)
        .set({ role })
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)));
      await tx.insert(auditLog).values({
        teamId: active.teamId,
        actorUserId: session.user.id,
        action: 'settings.change',
        targetType: 'team',
        targetId: active.teamId,
        targetVisibility: 'team',
        metadata: {
          setting: 'team.member_role',
          memberUserId,
          previousRole: target.role,
          role,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'last_owner') return;
    throw e;
  }
  revalidatePath('/app/team');
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
        .where(
          and(
            eq(teamMembers.teamId, active.teamId),
            eq(teamMembers.userId, memberUserId),
            isNull(teamMembers.removedAt),
          ),
        )
        .limit(1);
      const targetRole = targetRows[0]?.role;
      if (!targetRole) return;
      if (callerRole === 'admin' && targetRole !== 'member') return;
      if (callerRole !== 'owner' && callerRole !== 'admin') return;
      // Never strand a team with zero owners. `assertNotLastOwner` runs
      // SELECT FOR UPDATE on the team's owner rows so a concurrent removal
      // of a different owner cannot also pass this check.
      if (targetRole === 'owner') {
        await assertNotLastOwner(tx, active.teamId, memberUserId);
      }
      await tx
        .update(teamMembers)
        .set({ removedAt: new Date(), removedByUserId: session.user.id })
        .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)));
      await tx
        .update(teamVisibilityDefaults)
        .set({
          sourceOwnerUserId: null,
          visibility: 'team',
          visibilityUserIds: null,
          updatedByUserId: session.user.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(teamVisibilityDefaults.teamId, active.teamId),
            eq(teamVisibilityDefaults.sourceOwnerUserId, memberUserId),
            eq(teamVisibilityDefaults.visibility, 'private'),
          ),
        );
      await tx
        .update(teamVisibilityDefaults)
        .set({ sourceOwnerUserId: null, updatedByUserId: session.user.id, updatedAt: new Date() })
        .where(
          and(
            eq(teamVisibilityDefaults.teamId, active.teamId),
            eq(teamVisibilityDefaults.sourceOwnerUserId, memberUserId),
          ),
        );
      await tx
        .update(integrations)
        .set({ visibilityDefault: 'team', visibilityDefaultUserIds: null, updatedAt: new Date() })
        .where(
          and(
            eq(integrations.teamId, active.teamId),
            eq(integrations.connectedByUserId, memberUserId),
            or(
              eq(integrations.visibilityDefault, 'private'),
              eq(integrations.visibilityDefault, 'specific_users'),
            ),
          ),
        );

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
      await tx.insert(auditLog).values({
        teamId: active.teamId,
        actorUserId: session.user.id,
        action: 'settings.change',
        targetType: 'team',
        targetId: active.teamId,
        targetVisibility: 'team',
        metadata: { setting: 'team.member_removed', memberUserId, role: targetRole },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'last_owner') return;
    throw e;
  }
  revalidatePath('/app/team');
}
