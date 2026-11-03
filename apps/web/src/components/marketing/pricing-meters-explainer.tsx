import {
  FREE_ALLOWANCES,
  OVERAGE_RATES,
  formatEuroFromCents,
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
        <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">PAYG examples</h3>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          These are examples, not estimates of how many answers or imports you will get. If your
          recorded AI usage is {formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents + 200)} in a
          month, the {formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} included allowance leaves
          €2 of AI overage. With three or fewer active members and no other overages, that is €2
          before tax.
        </p>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          Using {FREE_ALLOWANCES.recallMinutes + 60} meeting minutes leaves 60 minutes above the
          included allowance: {formatEuroFromCents(60 * OVERAGE_RATES.recallCentsPerMinute)} before
          tax. AI processing, storage and other meters can add separate charges. Extra members and
          any platform fee are additional; see the comparison below.
        </p>
      </article>
      <article className="bg-bg p-5 sm:col-span-2 sm:p-6">
        <h3 className="text-lg font-semibold tracking-[-0.025em] text-fg">Free monthly floor</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">
          Every verified person receives the Free monthly floor on one owned workspace:{' '}
          {formatEuroFromCents(FREE_ALLOWANCES.aiChargeCents)} AI, {FREE_ALLOWANCES.recallMinutes}{' '}
          meeting minutes, {FREE_ALLOWANCES.emailUnits} email units, {FREE_ALLOWANCES.storageGb} GB
          storage, and {FREE_ALLOWANCES.acceptedSources.toLocaleString()} accepted sources — no card
          required. Additional owned workspaces stay restricted until you add a payment method. Pay
          as you go keeps that allowance after you add a payment method.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Capacity limits also apply: an allowance does not guarantee a fixed number of answers.{' '}
          <Link href="/help/billing" className="underline">
            How billing, limits and cancellation work
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
