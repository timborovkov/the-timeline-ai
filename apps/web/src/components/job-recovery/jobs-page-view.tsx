import type * as jobRecovery from '@timeline/shared/job-recovery';
import type { ReactNode } from 'react';

import { EmptyAction } from '@/components/empty-action';
import { JobRecoveryList } from '@/components/job-recovery/job-recovery-list';
import { JobsPageHeader } from '@/components/job-recovery/jobs-page-header';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;

export function JobsPageView({
  teamName,
  items,
  olderCount,
  defaultFilter,
}: {
  teamName: string;
  items: JobRecoveryItem[];
  olderCount: number;
  defaultFilter?: JobRecoveryKind;
}) {
  return (
    <JobRecoveryList
      teamName={teamName}
      items={items}
      olderCount={olderCount}
      defaultFilter={defaultFilter}
    />
  );
}

export function JobsForbiddenView({ teamName }: { teamName: string }): ReactNode {
  return (
    <div className="space-y-8">
      <JobsPageHeader teamName={teamName} />
      <EmptyAction
        title="Admins only"
        body="Job recovery is a team-admin queue. Ask an admin to retry or dismiss failed processing."
        href="/app"
        action="Back to Home"
      />
    </div>
  );
}
