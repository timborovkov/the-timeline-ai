import { teamInvites, teams } from '@timeline/db';
import { and, eq, isNull } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { acceptInviteAction } from '@/app/actions/invites';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function AcceptInvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const { error } = await searchParams;
  const session = await auth();

  if (!session?.user) {
    redirect(`/sign-up?invite=${encodeURIComponent(token)}`);
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
    .where(and(eq(teamInvites.token, token), isNull(teamInvites.acceptedAt)))
    .limit(1);
  const invite = invites[0];

  if (!invite || invite.expiresAt < new Date() || error === 'invalid') {
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
