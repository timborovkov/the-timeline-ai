'use server';

import { teamInvites, teamMembers, teams } from '@timeline/db';
import { buildInboundEmail, randomSlugSuffix, slugify } from '@timeline/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const acceptSchema = z.object({ token: z.string().min(1).max(256) });

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    const raw = formData.get('token');
    const t = typeof raw === 'string' ? raw : '';
    redirect(`/sign-up?invite=${encodeURIComponent(t)}`);
  }

  const parsed = acceptSchema.safeParse({ token: formData.get('token') });
  if (!parsed.success) redirect('/app/timeline');
  const { token } = parsed.data;
  const userId = session.user.id;
  const sessionEmail = session.user.email?.toLowerCase();

  let teamId: string;
  try {
    teamId = await db.transaction(async (tx) => {
      const invites = await tx
        .select()
        .from(teamInvites)
        .where(and(eq(teamInvites.token, token), isNull(teamInvites.acceptedAt)))
        .limit(1);
      const invite = invites[0];
      if (!invite || invite.expiresAt < new Date()) {
        throw new Error('invalid');
      }
      if (!sessionEmail || sessionEmail !== invite.email.toLowerCase()) {
        throw new Error('wrong-account');
      }

      const existing = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId)))
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(teamMembers).values({
          teamId: invite.teamId,
          userId,
          role: invite.role,
        });
      } else if (existing[0]?.role !== invite.role && existing[0]?.role !== 'owner') {
        // Re-accepting an invite is a legitimate way to change a member's
        // role (e.g. promote member → admin). Never demote an owner via this
        // path — owners must be removed/added explicitly.
        await tx
          .update(teamMembers)
          .set({ role: invite.role })
          .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId)));
      }
      await tx
        .update(teamInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(teamInvites.id, invite.id));
      return invite.teamId;
    });
  } catch (e) {
    // Only known sentinel reasons get surfaced in the URL; anything else
    // collapses to 'failed' so we never emit an unbounded error string.
    const raw = e instanceof Error ? e.message : '';
    const reason = raw === 'invalid' || raw === 'wrong-account' ? raw : 'failed';

    // Fallback: an OAuth user who arrived via /sign-up?invite=<token> skipped
    // the default solo-team creation in createUser. If invite acceptance then
    // fails (expired, revoked, email mismatch), they would be stranded with
    // zero memberships and no way to self-recover — createUser doesn't refire.
    // Spin them a solo team so they have a usable workspace, then surface the
    // invite error on the accept-invite page.
    await ensureFallbackSoloTeam(userId, session.user.name, session.user.email);
    await (await import('@/lib/pending-invite')).clearPendingInvite();
    redirect(`/accept-invite/${encodeURIComponent(token)}?error=${encodeURIComponent(reason)}`);
  }

  // Drop the OAuth pending-invite breadcrumb now that we've consumed it.
  const { clearPendingInvite } = await import('@/lib/pending-invite');
  await clearPendingInvite();

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/app/timeline');
}

/**
 * Idempotently ensure a user has at least one team. No-op when membership
 * already exists (the common case for repeat-accept failures). Mirrors the
 * default-team logic in NextAuth's `createUser` event so an OAuth signup
 * stranded by a failed invite still lands on a usable workspace.
 */
async function ensureFallbackSoloTeam(
  userId: string,
  name?: string | null,
  email?: string | null,
): Promise<void> {
  const existing = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);
  if (existing.length > 0) return;

  const label = name ?? email?.split('@')[0] ?? 'team';
  const slug = `${slugify(`${label}-team`) || 'team'}-${randomSlugSuffix()}`;
  const inboundEmail = buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(teams)
      .values({ name: `${label}'s Team`, slug, inboundEmail })
      .returning({ id: teams.id });
    const teamId = inserted[0]?.id;
    if (!teamId) throw new Error('failed to create fallback team');
    await tx.insert(teamMembers).values({ teamId, userId, role: 'owner' });
  });
}
