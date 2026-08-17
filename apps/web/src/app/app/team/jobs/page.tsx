import { JOB_RECOVERY_ATTENTION_DAYS } from '@timeline/shared/job-recovery';
import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { JobRecoveryList } from '@/components/job-recovery/job-recovery-list';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Jobs',
  description: 'Retry or dismiss failed processing from the last 7 days.',
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
  if (!canViewJobs) redirect('/app/team');

  const queue = await scope.jobRecovery.getRecoverableJobQueue();

  const defaultFilter =
    kind && VALID_JOB_KINDS.includes(kind as (typeof VALID_JOB_KINDS)[number])
      ? (kind as (typeof VALID_JOB_KINDS)[number])
      : undefined;

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Background jobs' }]} />
      <PageHeader
        title="Background jobs"
        subtitle={`Failed or stuck processing from the last ${String(JOB_RECOVERY_ATTENTION_DAYS)} days. Older backlog is retried automatically, then dropped from this list.`}
        metadata={[
          { label: 'team', value: active.teamName, signal: true },
          {
            label: 'need attention',
            value: queue.items.length,
            mono: true,
            danger: queue.items.length > 0,
          },
          ...(queue.olderCount > 0
            ? ([{ label: 'older hidden', value: queue.olderCount, mono: true }] as const)
            : []),
        ]}
        srLabel={`Background jobs for ${active.teamName}. ${String(queue.items.length)} need attention from the last ${String(JOB_RECOVERY_ATTENTION_DAYS)} days. ${queue.olderCount > 0 ? `${String(queue.olderCount)} older jobs are hidden.` : ''}`}
      />
      <JobRecoveryList
        items={queue.items}
        olderCount={queue.olderCount}
        defaultFilter={defaultFilter}
      />
    </div>
  );
}
