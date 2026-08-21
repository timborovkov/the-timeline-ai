import {
  FREE_ALLOWANCES,
  OVERAGE_RATES,
  PLAN_CATALOG,
  PUBLIC_PLAN_ORDER,
  type BillingPlanId,
  formatEuroFromCents,
} from '@timeline/shared/billing';

import { cn } from '@/lib/utils';

const COMPARISON_ROWS: Array<{
  label: string;
  value: (planId: BillingPlanId) => string;
}> = [
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

export function PricingPlanGrid({
  className,
  signedIn = false,
}: {
  className?: string;
  signedIn?: boolean;
}) {
  return (
    <div className={cn('grid gap-px border border-border bg-border lg:grid-cols-5', className)}>
      {PUBLIC_PLAN_ORDER.map((planId) => {
        const plan = PLAN_CATALOG[planId];
        const href = signedIn && planId !== 'enterprise' ? '/app/team?section=billing' : plan.cta.href;
        const label =
          signedIn && planId !== 'enterprise'
            ? planId === 'free'
              ? 'Open billing'
              : 'Manage plan'
            : plan.cta.label;
        return (
          <article
            key={plan.id}
            data-pricing-plan={plan.id}
            className={cn(
              'flex flex-col bg-bg p-5 sm:p-6',
              plan.highlighted && 'ring-1 ring-inset ring-signal',
            )}
          >
            <p className="font-mono text-[0.68rem] tracking-[0.12em] text-fg-muted uppercase">
              {plan.highlighted ? 'Recommended' : plan.name}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-fg">{plan.name}</h2>
            <p className="mt-2 min-h-[4.5rem] text-sm leading-6 text-fg-muted">{plan.tagline}</p>
            <p className="mt-4 font-mono text-3xl font-semibold tracking-[-0.04em] text-fg">
              {plan.platformFeeCents === null
                ? 'Custom'
                : plan.platformFeeCents === 0
                  ? '€0'
                  : formatEuroFromCents(plan.platformFeeCents)}
              {plan.platformFeeCents !== null && plan.platformFeeCents > 0 ? (
                <span className="text-base font-normal text-fg-muted">/mo</span>
              ) : null}
            </p>
            <a
              href={href}
              className={cn(
                'mt-6 inline-flex min-h-11 items-center justify-center rounded-sm px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                plan.highlighted
                  ? 'bg-signal text-bg hover:opacity-90'
                  : 'border border-border bg-surface text-fg hover:bg-bg',
              )}
            >
              {label}
            </a>
          </article>
        );
      })}
    </div>
  );
}

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

export function PricingMetersExplainer({ className }: { className?: string }) {
  const meters = [
    {
      name: 'AI',
      body: `Exact provider token cost × ${OVERAGE_RATES.aiCustomerMultiplier}. Shown in euros with model and operation detail — not opaque credits.`,
    },
    {
      name: 'Meetings',
      body: `${formatEuroFromCents(OVERAGE_RATES.recallCentsPerMinute)} per active bot/transcription minute (joining and waiting-room time count).`,
    },
    {
      name: 'Email',
      body: `${formatEuroFromCents(OVERAGE_RATES.emailCentsPerThousandUnits)} per 1,000 inbound messages and outbound recipients.`,
    },
    {
      name: 'Storage',
      body: `${formatEuroFromCents(OVERAGE_RATES.storageCentsPerGbMonth)} per GB-month of original files.`,
    },
    {
      name: 'Accepted sources',
      body: `${formatEuroFromCents(OVERAGE_RATES.acceptedSourcesCentsPerThousand)} per 1,000 accepted unique source items (AI triggered by those items is metered separately).`,
    },
  ] as const;

  return (
    <div className={cn('grid gap-px border border-border bg-border sm:grid-cols-2', className)}>
      {meters.map((meter) => (
        <article key={meter.name} className="bg-bg p-5 sm:p-6">
          <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">{meter.name}</h3>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{meter.body}</p>
        </article>
      ))}
      <article className="bg-bg p-5 sm:col-span-2 sm:p-6">
        <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">Free monthly floor</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
          Every workspace starts with {formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} AI,{' '}
          {FREE_ALLOWANCES.recallMinutes} meeting minutes, {FREE_ALLOWANCES.emailUnits} email units,{' '}
          {FREE_ALLOWANCES.storageGb} GB storage, and {FREE_ALLOWANCES.acceptedSources.toLocaleString()}{' '}
          accepted sources — no card required. Pay as you go keeps that allowance after you add a
          payment method.
        </p>
      </article>
    </div>
  );
}
