import { withTeam } from '@timeline/shared';
import { redirect } from 'next/navigation';

import { Breadcrumb } from '@/components/breadcrumb';
import { IndexStrip } from '@/components/index-strip';
import { JobRecoveryList } from '@/components/job-recovery/job-recovery-list';
import { JobDashboard } from '@/components/jobs/job-dashboard';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function JobRecoveryPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    await scope.requireMembership('admin');
  } catch {
    redirect('/app/team');
  }

  const items = await scope.jobRecovery.listRecoverableJobs();

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Breadcrumb items={[{ label: 'Team', href: '/app/team' }, { label: 'Job recovery' }]} />
      <IndexStrip
        srLabel={`Job recovery · ${String(items.length)} recoverable items`}
        segments={[
          { value: 'JOB RECOVERY' },
          { label: 'team', value: active.teamName, signal: true },
          { label: 'items', value: items.length },
        ]}
      />
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
          Processing summary
        </h2>
        <JobDashboard />
      </section>
      <JobRecoveryList items={items} />
    </div>
  );
}
