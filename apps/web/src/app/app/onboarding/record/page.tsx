import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { FirstRunPhase } from '@timeline/shared/onboarding';
import type { Metadata } from 'next';

import { FirstRecordScreen } from '@/components/onboarding/first-record-screen';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { loadFirstRunStatus } from '@/lib/first-run-status';

export const metadata: Metadata = {
  title: 'Your first record',
  description: 'A cited summary of what you just brought in.',
};

export const dynamic = 'force-dynamic';

const SETUP_PHASES = new Set<FirstRunPhase>(['welcome', 'choose', 'processing', 'failed']);
const HOME_PHASES = new Set<FirstRunPhase>(['skipped', 'complete']);

function destinationForRecordPhase(phase: FirstRunPhase | undefined): string | null {
  if (!phase || SETUP_PHASES.has(phase)) return '/onboarding';
  if (HOME_PHASES.has(phase)) return '/app';
  return null;
}

export default async function FirstRecordPage() {
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
  const destination = destinationForRecordPhase(firstRun?.phase);
  if (destination) redirect(destination);
  if (firstRun?.phase === 'record') {
    await withTeam(db, active.teamId, session.user.id).onboarding.setFirstRunPhase('record');
  }

  return (
    <FirstRecordScreen
      title={status.record?.title ?? 'Your first record'}
      meta={status.record?.meta ?? ''}
      summary={status.record?.summary ?? null}
      note={
        status.record?.note ??
        'The record starts updating itself once a channel or your email is connected.'
      }
      sources={status.record?.sources ?? []}
      suggestions={status.record?.suggestions ?? []}
    />
  );
}
