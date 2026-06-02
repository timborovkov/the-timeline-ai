import { teamInvites, teams } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';

import type { Metadata } from 'next';

import { acceptInviteAction } from '@/app/actions/invites';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Accept invite</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in if you already have an account, or sign up to create one with the invited
              email.
            </p>
            <div className="flex gap-3">
              <Button asChild>
                <Link href={signInHref}>Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={signUpHref}>Sign up</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
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
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Invite invalid</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This invite link has expired or has already been used. Ask the team owner for a new
              one.
            </p>
            <Button asChild>
              <Link href="/app/timeline">Continue</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!sessionEmail || sessionEmail !== invite.email.toLowerCase() || error === 'wrong-account') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Wrong account</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This invite was sent to{' '}
              <span className="font-medium text-foreground">{invite.email}</span>. Sign in with that
              email to accept.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (error === 'already-member') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle>Already a member</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This account is already a member of {invite.teamName}. Role changes happen from Team
              settings.
            </p>
            <Button asChild>
              <Link href="/app/timeline">Continue</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Join {invite.teamName}?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You've been invited to join <span className="font-medium">{invite.teamName}</span> as{' '}
            <span className="font-medium">{invite.role}</span>.
          </p>
          {error === 'failed' ? (
            <p className="text-sm text-destructive">
              Something went wrong while joining. Please try again.
            </p>
          ) : null}
          <form action={acceptInviteAction} className="flex items-center gap-3">
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Join team</Button>
            <Button asChild variant="ghost">
              <Link href="/app/timeline">Decline</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
