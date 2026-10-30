import {
  exhaustedFreeAllowanceNotice,
  getTeamCapacityUsage,
  resolveTeamCommercialTerms,
} from '@timeline/shared/billing';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { BILLING_NOTICE_TITLE, customerBillingState } from '@/components/billing-customer-state';
import { BillingStateBanner } from '@/components/billing-state-banner';
import { BillingUsageSummary } from '@/components/billing-usage-summary';
import { PageHeader } from '@/components/page-header';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Usage',
  description: 'Metered usage for this workspace.',
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
  const commercial = resolveTeamCommercialTerms(dashboard.account);
  const planId = commercial.planId;
  const state = customerBillingState({
    planId,
    billingState: dashboard.account.billingState,
    costBearingPaused: dashboard.costBearingPaused,
    freeRemaining: dashboard.freeRemaining,
    spendCapCents: dashboard.account.spendCapCents,
    meteredSpendCents: dashboard.meteredSpendCents,
    warnPercent: dashboard.utilization.percent,
  });
  const notice = state ? BILLING_NOTICE_TITLE[state] : null;

  if (!canManage) {
    const meterNotice =
      planId === 'free' ? exhaustedFreeAllowanceNotice(dashboard.freeRemaining) : null;
    const memberNotice = notice ?? meterNotice;
    return (
      <div className="space-y-5">
        <PageHeader variant="collection" title="Usage" />
        {memberNotice ? <BillingStateBanner title={memberNotice} /> : null}
      </div>
    );
  }

  const capacityUsage = await getTeamCapacityUsage({
    db,
    teamId: active.teamId,
    planId,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Usage"
        metadata={[{ label: 'Period', value: dashboard.periodYm, mono: true }]}
      />
      {notice ? (
        <BillingStateBanner title={notice}>
          {state === 'spend_cap' ? (
            <Link
              href="/app/team?section=billing#billing-spend-cap"
              className="text-sm font-medium text-fg underline-offset-4 hover:underline"
            >
              Raise cap
            </Link>
          ) : state === 'payment_failed' ? (
            <Link
              href="/app/team?section=billing"
              className="text-sm font-medium text-fg underline-offset-4 hover:underline"
            >
              Update payment method
            </Link>
          ) : null}
        </BillingStateBanner>
      ) : null}
      <BillingUsageSummary
        planId={planId}
        meters={dashboard.meters}
        capacityUsage={capacityUsage}
        includedActiveMembers={commercial.includedActiveMembers}
        additionalMemberCents={commercial.additionalMemberCents}
      />
    </div>
  );
}
