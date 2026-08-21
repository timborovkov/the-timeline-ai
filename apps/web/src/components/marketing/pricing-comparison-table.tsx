import {
  PLAN_CATALOG,
  PUBLIC_PLAN_ORDER,
  type BillingPlanId,
  formatEuroFromCents,
} from '@timeline/shared/billing';

import { cn } from '@/lib/utils';

const COMPARISON_ROWS: {
  label: string;
  value: (planId: BillingPlanId) => string;
}[] = [
  {
    label: 'Platform fee',
    value: (id) => {
      const fee = PLAN_CATALOG[id].platformFeeCents;
      if (fee === null) return 'Custom';
      return fee === 0 ? '€0' : `${formatEuroFromCents(fee)}/mo`;
    },
  },
  {
    label: 'Included active members',
    value: (id) => {
      const n = PLAN_CATALOG[id].includedActiveMembers;
      return n === null ? 'Custom' : String(n);
    },
  },
  {
    label: 'Extra members',
    value: (id) => {
      const n = PLAN_CATALOG[id].additionalMemberCents;
      if (PLAN_CATALOG[id].id === 'free') return 'Not available';
      if (n === null) return 'Custom';
      return `${formatEuroFromCents(n)}/member/mo`;
    },
  },
  {
    label: 'Metered usage',
    value: (id) => {
      const discount = PLAN_CATALOG[id].includedUsageDiscountCents;
      if (id === 'free') return 'Native Free allowances';
      if (id === 'enterprise') return 'Contract';
      if (discount > 0) return `Up to ${formatEuroFromCents(discount)} on invoice, then overage`;
      return 'Free allowance, then native overage';
    },
  },
  {
    label: 'Default spend cap',
    value: (id) => {
      const cap = PLAN_CATALOG[id].defaultSpendCapCents;
      if (id === 'enterprise') return 'Negotiated';
      if (cap === 0) return '€0 (hard stop)';
      return `${formatEuroFromCents(cap)}/mo`;
    },
  },
  {
    label: 'Support',
    value: (id) => PLAN_CATALOG[id].supportLabel,
  },
];

export function PricingComparisonTable({ className }: { className?: string }) {
  return (
    <div className={cn('overflow-x-auto border border-border', className)}>
      <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="px-4 py-3 font-medium text-fg-muted">Limit</th>
            {PUBLIC_PLAN_ORDER.map((planId) => (
              <th key={planId} className="px-4 py-3 font-semibold text-fg">
                {PLAN_CATALOG[planId].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-b-0">
              <th className="px-4 py-3 font-medium text-fg-muted">{row.label}</th>
              {PUBLIC_PLAN_ORDER.map((planId) => (
                <td key={planId} className="px-4 py-3 text-fg">
                  {row.value(planId)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
