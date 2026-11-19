import { SETUP_SHELL_PHASES } from '@timeline/shared/onboarding';
import { redirect } from 'next/navigation';

import { SetupFlow } from '@/components/onboarding/setup-flow';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadFirstRunStatus } from '@/lib/first-run-status';
import { resolveOnboardingConnectors } from '@/lib/onboarding-connectors';
import {
  parseOnboardingSourceIntent,
  readOnboardingSourceIntent,
} from '@/lib/onboarding-source-intent';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ source?: string }>;
}

export default async function OnboardingPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const [{ source: sourceParam }, cookieIntent] = await Promise.all([
    searchParams,
    readOnboardingSourceIntent(),
  ]);
  // Cookie clear happens in selectStarterPathAction (Server Action) — RSC cannot mutate cookies.
  const preferredSource = parseOnboardingSourceIntent(sourceParam) ?? cookieIntent;

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
    if (firstRun.phase === 'record') redirect('/app/onboarding/record');
    if (firstRun.phase === 'ask') redirect('/app/chat');
    if (firstRun.phase === 'approve') redirect('/app/approvals');
    if (firstRun.phase === 'live') redirect('/app/onboarding/live');
    redirect('/app');
  }

  const { connectors, telegramBotUsername } = resolveOnboardingConnectors();

  return (
    <SetupFlow
      initialStatus={status}
      preferredSource={preferredSource}
      connectors={connectors}
      telegramBotUsername={telegramBotUsername}
    />
  );
}
