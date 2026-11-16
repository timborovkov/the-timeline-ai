import { teamBillingAccounts, teamMembers, teams } from '@timeline/db';
import { and, eq, isNull, or, notInArray } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/sign-out-button';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function SuspendedWorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const available = await db
    .select({ id: teams.id, name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .leftJoin(teamBillingAccounts, eq(teamBillingAccounts.teamId, teams.id))
    .where(
      and(
        eq(teamMembers.userId, session.user.id),
        isNull(teamMembers.removedAt),
        or(
          isNull(teamBillingAccounts.securityState),
          notInArray(teamBillingAccounts.securityState, ['suspended', 'terminated']),
        ),
      ),
    );
  return (
    <main className="mx-auto max-w-lg space-y-5 px-6 py-16">
      <h1 className="text-xl font-semibold">Workspace suspended</h1>
      <p className="text-sm text-fg-muted">
        Access and new processing are paused. Your data is retained. Contact support for help
        restoring access.
      </p>
      <div className="flex flex-wrap items-start gap-3">
        <Button asChild>
          <Link href="/help/support">Get support</Link>
        </Button>
        <SignOutButton />
      </div>
      {available.map((team) => (
        <form key={team.id} action={`/app/team/switch/${team.id}`} method="post">
          <button type="submit" className="min-h-11 rounded-sm border border-border px-3 text-sm">
            Switch to {team.name}
          </button>
        </form>
      ))}
    </main>
  );
}
