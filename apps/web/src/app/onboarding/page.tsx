import { SETUP_SHELL_PHASES } from '@timeline/shared/onboarding';
import { redirect } from 'next/navigation';

import { SetupFlow } from '@/components/onboarding/setup-flow';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { defaultSoloTeamName } from '@/lib/default-team';
import { firstRunDestination } from '@/lib/first-run-poll';
import { loadFirstRunStatus } from '@/lib/first-run-status';

export const dynamic = 'force-dynamic';

function prefillTeamName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const trimmedName = name?.trim();
  if (trimmedName && trimmedName.length > 0) return defaultSoloTeamName(trimmedName);
  const local = email?.split('@')[0]?.trim();
  if (local && local.length > 0) return defaultSoloTeamName(local);
  return defaultSoloTeamName('team');
}

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);

  // Deferred solo create: signed-in users with zero memberships name their
  // workspace here. Invite joiners already have a team and never hit this.
  if (!active) {
    return (
      <SetupFlow
        initialStatus={{
          firstRun: null,
          inboundEmail: null,
          teamName: prefillTeamName(session.user.name, session.user.email),
          teamId: null,
          record: null,
        }}
      />
    );
  }

  const status = await loadFirstRunStatus({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    teamSlug: active.teamSlug,
    teamName: active.teamName,
  });
  const firstRun = status.firstRun;
  if (firstRun?.startedByUserId !== session.user.id) redirect('/app');
  if (!SETUP_SHELL_PHASES.includes(firstRun.phase)) {
    redirect(firstRunDestination(firstRun.phase));
  }

  return <SetupFlow initialStatus={status} />;
}
