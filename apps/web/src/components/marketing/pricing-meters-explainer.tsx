import {
  FREE_ALLOWANCES,
  OVERAGE_RATES,
  formatEuroFromCents,
  formatStorageGb,
} from '@timeline/shared/billing/catalog';
import Link from 'next/link';

import { cn } from '@/lib/utils';

const METER_COPY = [
  {
    name: 'AI',
    body: 'AI usage is metered in euros and varies by model, input size and generated output. Usage shows recorded charges by model and operation. Background extraction and indexing also use AI allowance.',
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
    name: 'Accepted source units',
    body: `${formatEuroFromCents(OVERAGE_RATES.acceptedSourcesCentsPerThousand)} per 1,000 source units. Ordinary accepted sources use one unit each; website crawling uses 20 units per captured page, including unchanged pages. AI and storage are metered separately.`,
  },
] as const;

export function PricingMetersExplainer({ className }: { className?: string }) {
  return (
    <details className={cn('border border-border bg-bg', className)}>
      <summary className="cursor-pointer p-5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        How this estimate works
      </summary>
      <div className="grid gap-px bg-border sm:grid-cols-2 sm:[&>article:nth-last-child(2)]:col-span-2">
        {METER_COPY.map((meter) => (
          <article key={meter.name} className="bg-bg p-5 sm:p-6">
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">{meter.name}</h3>
            <p className="mt-2 text-sm leading-6 text-fg-muted">{meter.body}</p>
          </article>
        ))}
        <article className="bg-bg p-5 sm:col-span-2 sm:p-6">
          <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">
            Included monthly usage
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
            Every verified person receives included monthly usage on one owned workspace:{' '}
            {formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} AI, {FREE_ALLOWANCES.recallMinutes}{' '}
            meeting minutes, {FREE_ALLOWANCES.emailUnits} email units,{' '}
            {formatStorageGb(FREE_ALLOWANCES.storageGb)} storage, and{' '}
            {FREE_ALLOWANCES.acceptedSources.toLocaleString()} accepted sources — no card required.
            Additional owned workspaces stay restricted until you add a payment method. Pay as you
            go keeps that allowance after you add a payment method.
          </p>
          <p className="mt-3 text-sm text-fg-muted">
            Capacity limits also apply: an allowance does not guarantee a fixed number of answers.{' '}
            <Link href="/help/billing" className="underline">
              How billing, limits and cancellation work
            </Link>
            {' · '}
            <Link href="#pricing-infrastructure" className="underline">
              Infrastructure limits
            </Link>
            .
          </p>
        </article>
      </div>
    </details>
  );
}
