import Link from 'next/link';

import type { BillingNudge } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

function showPricingLink(kind: BillingNudge['kind']): boolean {
  return (
    kind === 'free_near_limit' ||
    kind === 'free_exhausted' ||
    kind === 'suggest_commitment' ||
    kind === 'suggest_payg'
  );
}

/** Quiet gray upgrade / spend-cap nudge for in-app surfaces. */
export function BillingUpgradeNudge({
  nudge,
  className,
}: {
  nudge: BillingNudge;
  className?: string;
}) {
  return (
    <output
      data-billing-nudge={nudge.kind}
      className={cn(
        'flex flex-col gap-3 border border-border bg-surface-2/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{nudge.title}</p>
        <p className="mt-1 text-sm leading-6 text-fg-muted">{nudge.body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link
          href={nudge.href}
          className="inline-flex min-h-10 items-center justify-center rounded-sm border border-border bg-bg px-3 text-sm font-medium text-fg hover:bg-surface"
        >
          {nudge.ctaLabel}
        </Link>
        {showPricingLink(nudge.kind) ? (
          <Link
            href="/pricing"
            className="inline-flex min-h-10 items-center justify-center px-2 text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
          >
            See pricing
          </Link>
        ) : null}
      </div>
    </output>
  );
}
