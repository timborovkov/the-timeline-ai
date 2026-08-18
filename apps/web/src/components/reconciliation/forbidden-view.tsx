import type { ReactNode } from 'react';

import { EmptyAction } from '@/components/empty-action';
import { ReconciliationPageHeader } from '@/components/reconciliation/page-header';

export function ReconciliationForbiddenView({ teamName }: { teamName: string }): ReactNode {
  return (
    <div className="space-y-8">
      <ReconciliationPageHeader teamName={teamName} />
      <EmptyAction
        title="Admins only"
        body="Reconciliation is a team-admin health view. Ask an admin if you need the latest snapshot."
        href="/app"
        action="Back to Home"
      />
    </div>
  );
}
