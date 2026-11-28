import { isJobRecoveryKind } from '@timeline/shared/job-recovery/policy';
import { withTeam } from '@timeline/shared/team-scope';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { jobsPageSubtitle } from '@/components/job-recovery/jobs-attention';
import { JobsForbiddenView, JobsPageView } from '@/components/job-recovery/jobs-page-view';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Job recovery',
  description: jobsPageSubtitle(),
};

export const dynamic = 'force-dynamic';

export default async function JobRecoveryPage(props: { searchParams: Promise<{ kind?: string }> }) {
  const [{ kind }, session] = await Promise.all([props.searchParams, auth()]);
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  let canViewJobs = true;
  try {
    await scope.requireMembership('admin');
  } catch {
    canViewJobs = false;
  }
  if (!canViewJobs) {
    return <JobsForbiddenView teamName={active.teamName} />;
  }

  const queue = await scope.jobRecovery.getRecoverableJobQueue();

  const defaultFilter = isJobRecoveryKind(kind) ? kind : undefined;

  return (
    <JobsPageView
      teamName={active.teamName}
      items={queue.items}
      olderCount={queue.olderCount}
      defaultFilter={defaultFilter}
    />
  );
}
