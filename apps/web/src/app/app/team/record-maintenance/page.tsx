import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/page-header';
import { RecordMaintenanceForm } from '@/components/record-maintenance-form';
import { resolveScope } from '@/lib/action-scope';

export default async function RecordMaintenancePage() {
  const scope = await resolveScope();
  if (!scope.ok) redirect('/app/team');
  const role = await scope.scope.requireMembership();
  if (role === 'member') redirect('/app/team');
  const policy = await scope.scope.suggestions.getRecordMaintenancePolicy();

  return (
    <div className="space-y-4">
      <Link href="/app/team?section=advanced" className="text-sm text-signal underline">
        Back to team settings
      </Link>
      <PageHeader title="Record maintenance" subtitle="Choose which changes require review." />
      <RecordMaintenanceForm policy={policy} />
    </div>
  );
}
