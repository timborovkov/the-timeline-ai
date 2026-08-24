import {
  CAPACITY_BY_PLAN,
  PLAN_CATALOG,
  SELF_SERVE_PLAN_ORDER,
  type BillingPlanId,
  formatEuroFromCents,
} from '@timeline/shared/billing/catalog';

import { cn } from '@/lib/utils';

function formatStock(n: number | null, options?: { unit: string } | { zero: string }): string {
  if (n === null) return 'Custom';
  if (n === 0) {
    return options && 'zero' in options ? options.zero : 'Not included';
  }
  const formatted = n.toLocaleString('en-IE');
  return options && 'unit' in options ? `${formatted} ${options.unit}` : formatted;
}

const COMMERCIAL_ROWS: {
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
      if (discount > 0) return `Up to ${formatEuroFromCents(discount)} on invoice, then overage`;
      return 'Free allowance, then native overage';
    },
  },
  {
    label: 'Default spend cap',
    value: (id) => {
      const cap = PLAN_CATALOG[id].defaultSpendCapCents;
      if (cap === 0) return '€0 (hard stop)';
      return `${formatEuroFromCents(cap)}/mo`;
    },
  },
  {
    label: 'Support',
    value: (id) => PLAN_CATALOG[id].supportLabel,
  },
];

const INFRASTRUCTURE_ROWS: {
  label: string;
  value: (planId: BillingPlanId) => string;
}[] = [
  {
    label: 'Ask turns / month',
    value: (id) => formatStock(CAPACITY_BY_PLAN[id].agentTurnsPerMonth),
  },
  {
    label: 'Concurrent meeting notetakers',
    value: (id) => formatStock(CAPACITY_BY_PLAN[id].concurrentRecallBots),
  },
  {
    label: 'Custom MCP servers',
    value: (id) => formatStock(CAPACITY_BY_PLAN[id].customMcpServers, { zero: 'Not included' }),
  },
  {
    label: 'Documents',
    value: (id) => formatStock(CAPACITY_BY_PLAN[id].documents),
  },
  {
    label: 'File storage',
    value: (id) => formatStock(CAPACITY_BY_PLAN[id].storageGb, { unit: 'GB' }),
  },
];

function ComparisonTable({
  rows,
  caption,
}: {
  rows: { label: string; value: (planId: BillingPlanId) => string }[];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className="px-4 py-3 font-medium text-fg-muted">Limit</th>
            {SELF_SERVE_PLAN_ORDER.map((planId) => (
              <th key={planId} className="px-4 py-3 font-semibold text-fg">
                {PLAN_CATALOG[planId].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-border last:border-b-0">
              <th className="px-4 py-3 font-medium text-fg-muted">{row.label}</th>
              {SELF_SERVE_PLAN_ORDER.map((planId) => (
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

export function PricingComparisonTable({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <ComparisonTable rows={COMMERCIAL_ROWS} caption="Commercial plan comparison" />
      <details data-pricing-infrastructure className="border border-border bg-bg">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg-muted hover:text-fg">
          Infrastructure limits
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          <p className="max-w-[64ch] text-sm leading-6 text-fg-muted">
            Plan capacity ceilings, not billed usage. They keep the service healthy and can pause
            one action without charging extra.
          </p>
          <ComparisonTable rows={INFRASTRUCTURE_ROWS} caption="Infrastructure plan limits" />
        </div>
      </details>
    </div>
  );
}
