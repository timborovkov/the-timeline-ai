'use client';

import { formatEuroFromCents } from '@timeline/shared/billing/catalog';

import type { CheapestPlanPreview } from '@timeline/shared/billing/preview';

const PLAN_LABEL: Record<CheapestPlanPreview['recommended'], string> = {
  payg: 'Pay as you go',
  team: 'Team',
  business: 'Business',
};

export function BillingPlanPreview({
  preview,
  currentPlanId,
}: {
  preview: CheapestPlanPreview;
  currentPlanId: string;
}) {
  const recommended = PLAN_LABEL[preview.recommended];
  const currentIsRecommended = currentPlanId === preview.recommended;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-fg">
        {currentIsRecommended
          ? `${recommended} is currently the cheapest self-serve option from this period's members and metered usage.`
          : `${recommended} would be cheaper this period. Timeline never switches plans automatically.`}
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
  );
}
