import { ShieldAlert } from 'lucide-react';

import type { ReactNode } from 'react';

import { EmptyState } from '@/components/empty-state';
import { ReconciliationPageHeader } from '@/components/reconciliation/page-header';

export function ReconciliationForbiddenView({ teamName }: { teamName: string }): ReactNode {
  return (
    <div className="space-y-8">
      <ReconciliationPageHeader teamName={teamName} />
      <EmptyState
        icon={ShieldAlert}
        title="Admins only"
        body="Reconciliation is a team-admin health view. Ask an admin if you need the latest snapshot."
        href="/app"
        action="Back to Home"
      />
    </div>
  );
}
