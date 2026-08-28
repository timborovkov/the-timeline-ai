'use server';

import { teamInvites, teamMembers, users, type TeamMemberPriorInterval } from '@timeline/db';
import { assertTeamMemberSeatCapacity, isBillingAdmissionError } from '@timeline/shared/billing';
import { childLogger } from '@timeline/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { ACTIVE_TEAM_COOKIE } from '@/lib/active-team';
import { trackProductEventBestEffort } from '@/lib/analytics';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { ensureSoloTeam } from '@/lib/default-team';
import { runSentryServerAction } from '@/lib/sentry-action';
import { reportCaughtError } from '@/lib/sentry-report';

const log = childLogger('web:actions:invites');

const acceptSchema = z.object({ token: z.string().min(1).max(256) });
const recipientInviteSchema = z.object({ inviteId: z.uuid() });

type InviteDbTx = {
  select: typeof db.select;
  insert: typeof db.insert;
  update: typeof db.update;
};

async function acceptTeamMembership(
  tx: InviteDbTx,
  input: { teamId: string; userId: string; role: 'admin' | 'member' },
): Promise<void> {
  const existing = await tx
    .select({
      role: teamMembers.role,
      removedAt: teamMembers.removedAt,
      createdAt: teamMembers.createdAt,
      priorIntervals: teamMembers.priorIntervals,
    })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)))
    .limit(1)
    .for('update');
  const membership = existing[0];
  if (membership && !membership.removedAt) {
    throw new Error('already-member');
  }
  if (membership) {
    const priorIntervals: TeamMemberPriorInterval[] = [
      ...(membership.priorIntervals ?? []),
      ...(membership.removedAt
        ? [
            {
              startedAt: membership.createdAt.toISOString(),
              endedAt: membership.removedAt.toISOString(),
            },
          ]
        : []),
    ];
    await tx
      .update(teamMembers)
      .set({
        role: input.role,
        removedAt: null,
        removedByUserId: null,
        createdAt: new Date(),
        priorIntervals,
      })
      .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId)));
    return;
  }
  await tx.insert(teamMembers).values({
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
  });
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  return runSentryServerAction('accept_invite', async () => {
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

    let accepted: { teamId: string; role: 'admin' | 'member' } | null = null;
    let failedInviteRedirect: string | null = null;
    try {
      accepted = await db.transaction(async (tx) => {
        const invites = await tx
          .select()
          .from(teamInvites)
          .where(
            and(
              eq(teamInvites.token, token),
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
            ),
          )
          .limit(1)
          .for('update');
        const invite = invites[0];
        if (!invite || invite.expiresAt < new Date() || invite.role === 'owner') {
          throw new Error('invalid');
        }
        if (!sessionEmail || sessionEmail !== invite.email.toLowerCase()) {
          throw new Error('wrong-account');
        }

        const existing = await tx
          .select({ role: teamMembers.role, removedAt: teamMembers.removedAt })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId)))
          .limit(1)
          .for('update');
        const membership = existing[0];
        if (membership && !membership.removedAt) {
          throw new Error('already-member');
        }
        await assertTeamMemberSeatCapacity({
          db: tx as unknown as typeof db,
          teamId: invite.teamId,
          additionalSeats: 1,
          includePendingInvites: false,
        });
        await acceptTeamMembership(tx, {
          teamId: invite.teamId,
          userId,
          role: invite.role,
        });
        await tx
          .update(teamInvites)
          .set({ acceptedAt: new Date(), acceptedByUserId: userId })
          .where(eq(teamInvites.id, invite.id));
        await tx
          .update(teamInvites)
          .set({ revokedAt: new Date(), revokedByUserId: userId })
          .where(
            and(
              eq(teamInvites.teamId, invite.teamId),
              sql`lower(${teamInvites.email}) = ${invite.email.toLowerCase()}`,
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
              sql`${teamInvites.id} <> ${invite.id}`,
            ),
          );
        return { teamId: invite.teamId, role: invite.role };
      });
    } catch (e) {
      // Only known sentinel reasons get surfaced in the URL; anything else
      // collapses to 'failed' so we never emit an unbounded error string.
      const raw = e instanceof Error ? e.message : '';
      const reason =
        raw === 'invalid' ||
        raw === 'wrong-account' ||
        raw === 'already-member' ||
        raw === 'member-limit'
          ? raw
          : isBillingAdmissionError(e)
            ? 'member-limit'
            : 'failed';
      reportCaughtError(e, {
        surface: 'server_action',
        operation: 'accept_invite',
        tags: { reason },
      });

      // Fallback: an OAuth user who arrived via /sign-up?invite=<token> skipped
      // the default solo-team creation in createUser. If invite acceptance then
      // fails (expired, revoked, email mismatch), they would be stranded with
      // zero memberships and no way to self-recover — createUser doesn't refire.
      // Spin them a solo team so they have a usable workspace, then surface the
      // invite error on the accept-invite page.
      //
      // Best-effort: a DB hiccup during the fallback must NOT mask the original
      // invite error. Log and continue to the redirect so the user lands on a
      // page they can act on (instead of a generic 500).
      try {
        await ensureSoloTeam(userId, { name: session.user.name, email: session.user.email });
        const { clearPendingInvite } = await import('@/lib/pending-invite');
        await clearPendingInvite();
      } catch (fallbackErr) {
        log.error(
          { err: (fallbackErr as Error).message, userId, reason },
          'invite_fallback_solo_team_failed',
        );
        reportCaughtError(fallbackErr, {
          surface: 'server_action',
          operation: 'restore_solo_team_after_invite_failure',
        });
      }
      failedInviteRedirect = `/accept-invite/${encodeURIComponent(token)}?error=${encodeURIComponent(
        reason,
      )}`;
    }
    if (failedInviteRedirect) redirect(failedInviteRedirect);
    if (!accepted) redirect('/app/timeline');

    // Drop the OAuth pending-invite breadcrumb now that we've consumed it.
    const { clearPendingInvite } = await import('@/lib/pending-invite');
    await clearPendingInvite();

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TEAM_COOKIE, accepted.teamId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    trackProductEventBestEffort(userId, 'invite_accepted', {
      teamId: accepted.teamId,
      userId,
      role: accepted.role,
      source: 'accept_invite',
    });
    redirect('/app/timeline');
  });
}

export async function declineInviteAction(formData: FormData): Promise<void> {
  return runSentryServerAction('decline_invite', async () => {
    const session = await auth();
    if (!session?.user) return;
    const parsed = recipientInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
    if (!parsed.success) return;
    const currentUsers = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const currentUser = currentUsers[0];
    if (!currentUser?.email) return;
    const currentEmail = currentUser.email.toLowerCase();

    await db
      .update(teamInvites)
      .set({ revokedAt: new Date(), revokedByUserId: session.user.id })
      .where(
        and(
          eq(teamInvites.id, parsed.data.inviteId),
          sql`lower(${teamInvites.email}) = ${currentEmail}`,
          isNull(teamInvites.acceptedAt),
          isNull(teamInvites.revokedAt),
        ),
      );

    revalidatePath('/app', 'layout');
  });
}

export async function acceptRecipientInviteAction(formData: FormData): Promise<void> {
  return runSentryServerAction('accept_recipient_invite', async () => {
    const session = await auth();
    if (!session?.user) return;
    const parsed = recipientInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
    if (!parsed.success) return;
    const userId = session.user.id;

    let accepted: { teamId: string; role: 'admin' | 'member' };
    try {
      accepted = await db.transaction(async (tx) => {
        const currentUsers = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const currentUser = currentUsers[0];
        if (!currentUser?.email) throw new Error('wrong-account');

        const invites = await tx
          .select()
          .from(teamInvites)
          .where(
            and(
              eq(teamInvites.id, parsed.data.inviteId),
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
            ),
          )
          .limit(1)
          .for('update');
        const invite = invites[0];
        if (!invite || invite.expiresAt < new Date() || invite.role === 'owner') {
          throw new Error('invalid');
        }
        if (invite.email.toLowerCase() !== currentUser.email.toLowerCase()) {
          throw new Error('wrong-account');
        }

        const existing = await tx
          .select({ role: teamMembers.role, removedAt: teamMembers.removedAt })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, userId)))
          .limit(1)
          .for('update');
        const membership = existing[0];
        if (membership && !membership.removedAt) {
          throw new Error('already-member');
        }

        await assertTeamMemberSeatCapacity({
          db: tx as unknown as typeof db,
          teamId: invite.teamId,
          additionalSeats: 1,
          includePendingInvites: false,
        });

        await acceptTeamMembership(tx, {
          teamId: invite.teamId,
          userId,
          role: invite.role,
        });
        await tx
          .update(teamInvites)
          .set({ acceptedAt: new Date(), acceptedByUserId: userId })
          .where(eq(teamInvites.id, invite.id));
        await tx
          .update(teamInvites)
          .set({ revokedAt: new Date(), revokedByUserId: userId })
          .where(
            and(
              eq(teamInvites.teamId, invite.teamId),
              sql`lower(${teamInvites.email}) = ${invite.email.toLowerCase()}`,
              isNull(teamInvites.acceptedAt),
              isNull(teamInvites.revokedAt),
              sql`${teamInvites.id} <> ${invite.id}`,
            ),
          );
        return { teamId: invite.teamId, role: invite.role };
      });
    } catch (err) {
      reportCaughtError(err, { surface: 'server_action', operation: 'accept_recipient_invite' });
      revalidatePath('/app', 'layout');
      return;
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TEAM_COOKIE, accepted.teamId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    trackProductEventBestEffort(userId, 'invite_accepted', {
      teamId: accepted.teamId,
      userId,
      role: accepted.role,
      source: 'accept_invite',
    });
    redirect('/app/timeline');
  });
}
