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
    await db.update(teams).set({ name: parsed.data.name }).where(eq(teams.id, parsed.data.teamId));
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
