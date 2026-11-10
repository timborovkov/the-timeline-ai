import { getDigestPreference } from '@timeline/shared/messaging';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { GoLiveScreen } from '@/components/onboarding/go-live-screen';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadFirstRunStatus } from '@/lib/first-run-status';

export const metadata: Metadata = {
  title: 'Go live',
  description: 'Connect a channel so the record keeps itself current.',
};

export const dynamic = 'force-dynamic';

export default async function GoLivePage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const status = await loadFirstRunStatus({
    db,
    teamId: active.teamId,
    userId: session.user.id,
    teamSlug: active.teamSlug,
    teamName: active.teamName,
  });
  const firstRun = status.firstRun;
  if (!firstRun || firstRun.phase === 'welcome' || firstRun.phase === 'choose') {
    redirect('/onboarding');
  }
  if (firstRun.phase === 'skipped' || firstRun.phase === 'complete') {
    redirect('/app');
  }

  const scope = withTeam(db, active.teamId, session.user.id);
  if (firstRun.phase !== 'live') {
    await scope.onboarding.setFirstRunPhase('live');
  }
  const digestPreference = await getDigestPreference({
    db,
    teamId: active.teamId,
    userId: session.user.id,
  });

  return (
    <GoLiveScreen
      workStyle={firstRun.workStyle}
      inboundEmail={status.inboundEmail}
      digestEnabled={digestPreference.enabled}
    />
  );
}
