'use client';

import { formatEuroFromCents } from '@timeline/shared/billing/catalog';
import {
  shouldShowPlanRecommendation,
  type CheapestPlanPreview,
} from '@timeline/shared/billing/preview';

import { SettingsSection } from '@/components/section-heading';

const PLAN_LABEL: Record<CheapestPlanPreview['recommended'], string> = {
  payg: 'Pay as you go',
  team: 'Team',
  business: 'Business',
};

export function BillingPlanPreview({
  preview,
  currentPlanId,
  activeMemberCount,
}: {
  preview: CheapestPlanPreview;
  currentPlanId: string;
  activeMemberCount: number;
}) {
  if (!shouldShowPlanRecommendation(preview, currentPlanId)) return null;

  const recommended = PLAN_LABEL[preview.recommended];

  return (
    <SettingsSection title="Cheapest plan this period">
      <div className="space-y-3 text-sm">
        <p className="text-fg">
          {recommended} would be cheaper this period. Timeline never switches plans automatically.
        </p>
        <dl className="grid gap-2 font-mono text-xs sm:grid-cols-3">
          {(['payg', 'team', 'business'] as const).map((planId) => {
            const bill = preview.bills[planId];
            return (
              <div key={planId} className="border border-border bg-bg px-3 py-2">
                <dt className="font-sans text-fg-muted">{PLAN_LABEL[planId]}</dt>
                <dd className="mt-1 text-fg">{formatEuroFromCents(bill.totalCents)}</dd>
              </div>
            );
          })}
        </dl>
      </div>
      <p className="mt-3 text-sm text-fg-muted">
        Preview uses {activeMemberCount} active members and metered usage so far this period. Extra
        members are €2 per member-month on paid self-serve plans.
      </p>
    </SettingsSection>
  );
}
