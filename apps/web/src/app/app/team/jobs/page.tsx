import { withTeam } from '@timeline/shared/team-scope';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { JobRecoveryList } from '@/components/job-recovery/job-recovery-list';
import { JobDashboard } from '@/components/jobs/job-dashboard';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Jobs',
  description: 'Review background jobs, retries, and finished history.',
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

  const items = await scope.jobRecovery.listRecoverableJobs();

  const defaultFilter =
    kind && VALID_JOB_KINDS.includes(kind as (typeof VALID_JOB_KINDS)[number])
      ? (kind as (typeof VALID_JOB_KINDS)[number])
      : undefined;

  return (
    <div className="space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Background jobs' }]} />
      <IndexStrip
        srLabel={`Background jobs · ${String(items.length)} items need attention`}
        segments={[
          { value: 'BACKGROUND JOBS' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'needs attention', value: items.length },
        ]}
      />
      <section aria-labelledby="processing-summary-heading" className="space-y-3">
        <h2 id="processing-summary-heading" className="text-base font-semibold text-fg">
          Processing summary
        </h2>
        <JobDashboard />
      </section>
      <JobRecoveryList items={items} defaultFilter={defaultFilter} />
    </div>
  );
}
