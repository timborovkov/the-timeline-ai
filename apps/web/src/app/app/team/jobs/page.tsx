import { redirect } from 'next/navigation';

import { JobDashboard } from '@/components/jobs/job-dashboard';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';

export default async function TeamJobsPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active || active.role === 'member') redirect('/app/team');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Job recovery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Team-scoped processing health for visible product workflows.
        </p>
      </header>
      <JobDashboard />
    </div>
  );
}
