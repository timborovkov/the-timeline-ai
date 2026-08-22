import { getTeamCapacityUsage, PLAN_CATALOG } from '@timeline/shared/billing';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BillingUpgradeNudge } from '@/components/billing-upgrade-nudge';
import { BillingUsageSummary } from '@/components/billing-usage-summary';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Usage',
  description:
    'Metered usage, Free allowances, plan limits, and spend-cap utilization for this workspace.',
};

export default async function UsagePage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  const role = await scope.requireMembership();
  const canManage = role === 'owner' || role === 'admin';
  const dashboard = await scope.billing.getDashboard({ canManageBilling: canManage });
  const planName = PLAN_CATALOG[dashboard.account.planId].name;
  const capacityUsage = await getTeamCapacityUsage({
    db,
    teamId: active.teamId,
    planId: dashboard.account.planId,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Usage"
        subtitle="Native meters, plan limits, and euro values for this billing period."
        metadata={[
          { label: 'Plan', value: planName },
          { label: 'Period', value: dashboard.periodYm, mono: true },
        ]}
      >
        <PageHeader.Trailing>
          {canManage ? (
            <Link
              href="/app/team?section=billing"
              className="inline-flex min-h-10 items-center rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-bg"
            >
              Billing settings
            </Link>
          ) : null}
        </PageHeader.Trailing>
      </PageHeader>

      {dashboard.nudge ? <BillingUpgradeNudge nudge={dashboard.nudge} /> : null}

      <BillingUsageSummary
        periodYm={dashboard.periodYm}
        planName={planName}
        planId={dashboard.account.planId}
        utilization={dashboard.utilization}
        freeRemaining={dashboard.freeRemaining}
        meteredSpendCents={dashboard.meteredSpendCents}
        meters={dashboard.meters}
        capacityUsage={capacityUsage}
        costBearingPaused={dashboard.costBearingPaused}
      />
    </div>
  );
}
