import { teamInvites, teams } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';

import type { Metadata } from 'next';

import { acceptInviteAction } from '@/app/actions/invites';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Accept invite',
  description: 'Review and accept a team invitation.',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function AcceptInvitePage({ params, searchParams }: Props) {
  const [{ token }, { error }, session] = await Promise.all([params, searchParams, auth()]);

  if (!session?.user) {
    // Show a choice: existing users sign in (and come back here), new users
    // sign up with the invite. Unconditional redirect to sign-up would force
    // existing accounts through a duplicate-email error.
    const inviteUrl = `/accept-invite/${encodeURIComponent(token)}`;
    const signInHref = `/sign-in?callbackUrl=${encodeURIComponent(inviteUrl)}`;
    const signUpHref = `/sign-up?invite=${encodeURIComponent(token)}`;
    return (
      <AuthShell
        title="Accept invite"
        subtitle="Sign in if you already have an account, or sign up to create one with the invited email."
      >
        <div className="flex gap-3">
          <Button asChild>
            <Link href={signInHref}>Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={signUpHref}>Sign up</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const sessionEmail = session.user.email?.toLowerCase();

  // Look up the invite to render the confirmation page; the actual join
  // only happens when the user POSTs the form below (via acceptInviteAction).
  // This prevents email-preview crawlers and prefetchers from burning the
  // invite by merely visiting the URL.
  const invites = await db
    .select({
      inviteId: teamInvites.id,
      teamId: teamInvites.teamId,
      email: teamInvites.email,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt,
      teamName: teams.name,
    })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(
      and(
        eq(teamInvites.token, token),
        isNull(teamInvites.acceptedAt),
        isNull(teamInvites.revokedAt),
      ),
    )
    .limit(1);
  const invite = invites[0];

  if (!invite || invite.expiresAt < new Date() || invite.role === 'owner' || error === 'invalid') {
    return (
      <AuthShell
        title="Invite invalid"
        subtitle="This invite link has expired or has already been used. Ask the team owner for a new one."
      >
        <Button asChild>
          <Link href="/app/timeline">Continue</Link>
        </Button>
      </AuthShell>
    );
  }

  if (!sessionEmail || sessionEmail !== invite.email.toLowerCase() || error === 'wrong-account') {
    return (
      <AuthShell title="Wrong account">
        <p className="text-sm text-muted-foreground">
          This invite was sent to{' '}
          <span className="font-medium text-foreground">{invite.email}</span>. Sign in with that
          email to accept.
        </p>
      </AuthShell>
    );
  }

  if (error === 'already-member') {
    return (
      <AuthShell
        title="Already a member"
        subtitle={`This account is already a member of ${invite.teamName}. Role changes happen from Team settings.`}
      >
        <Button asChild>
          <Link href="/app/timeline">Continue</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`Join ${invite.teamName}?`}>
      <p className="text-sm text-muted-foreground">
        You've been invited to join <span className="font-medium">{invite.teamName}</span> as{' '}
        <span className="font-medium">{invite.role}</span>.
      </p>
      {error === 'failed' ? (
        <p className="text-sm text-destructive">
          Something went wrong while joining. Please try again.
        </p>
      ) : null}
      {error === 'member-limit' ? (
        <p className="text-sm text-destructive">
          This plan’s member limit is reached. Ask an owner to upgrade before you join.
        </p>
      ) : null}
      <form action={acceptInviteAction} className="flex items-center gap-3">
        <input type="hidden" name="token" value={token} />
        <Button type="submit">Join team</Button>
        <Button asChild variant="ghost">
          <Link href="/app/timeline">Decline</Link>
        </Button>
      </form>
    </AuthShell>
  );
}
