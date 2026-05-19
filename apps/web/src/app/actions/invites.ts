'use server';

import { teamInvites, teamMembers } from '@timeline/db';
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
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId)))
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(teamMembers).values({
          teamId: invite.teamId,
          userId,
          role: invite.role,
        });
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
    redirect(`/accept-invite/${encodeURIComponent(token)}?error=${encodeURIComponent(reason)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TEAM_COOKIE, teamId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/app/timeline');
}
