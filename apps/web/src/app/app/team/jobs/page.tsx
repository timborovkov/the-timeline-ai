import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { jobsPageSubtitle } from '@/components/job-recovery/jobs-page-header';
import { JobsForbiddenView, JobsPageView } from '@/components/job-recovery/jobs-page-view';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Job recovery',
  description: jobsPageSubtitle(),
};

const VALID_JOB_KINDS = [
  'transcription',
  'extraction',
  'embedding',
  'document_processing',
  'meeting_finalization',
  'integration_sync',
] as const;

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

  const defaultFilter =
    kind && VALID_JOB_KINDS.includes(kind as (typeof VALID_JOB_KINDS)[number])
      ? (kind as (typeof VALID_JOB_KINDS)[number])
      : undefined;

  return (
    <JobsPageView
      teamName={active.teamName}
      items={queue.items}
      olderCount={queue.olderCount}
      defaultFilter={defaultFilter}
    />
  );
}
