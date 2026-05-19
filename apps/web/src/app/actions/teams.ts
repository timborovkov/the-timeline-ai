'use server';

import { teamInvites, teamMembers, teams } from '@timeline/db';
import { randomSlugSuffix, randomToken, slugify, withTeam } from '@timeline/shared';
import { and, eq } from 'drizzle-orm';
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
  let teamId: string;
  try {
    teamId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(teams)
        .values({ name: parsed.data.name, slug })
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

  // Admins cannot remove owners; only another owner can.
  const targetRows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)))
    .limit(1);
  const targetRole = targetRows[0]?.role;
  if (!targetRole) return;
  if (targetRole === 'owner' && callerRole !== 'owner') return;

  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, active.teamId), eq(teamMembers.userId, memberUserId)));
  revalidatePath('/app/team');
}
