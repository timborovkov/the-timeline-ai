import { FREE_ALLOWANCES, OVERAGE_RATES, formatEuroFromCents } from '@timeline/shared/billing';

import { cn } from '@/lib/utils';

const METER_COPY = [
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

export function PricingMetersExplainer({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-px border border-border bg-border sm:grid-cols-2', className)}>
      {METER_COPY.map((meter) => (
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
          {FREE_ALLOWANCES.storageGb} GB storage, and{' '}
          {FREE_ALLOWANCES.acceptedSources.toLocaleString()} accepted sources — no card required.
          Pay as you go keeps that allowance after you add a payment method.
        </p>
      </article>
    </div>
  );
}
