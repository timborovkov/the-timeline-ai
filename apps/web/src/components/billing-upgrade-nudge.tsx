import Link from 'next/link';

import type { BillingNudge } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

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
      <Link
        href={nudge.href}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-sm border border-border bg-bg px-3 text-sm font-medium text-fg hover:bg-surface"
      >
        {nudge.ctaLabel}
      </Link>
    </output>
  );
}
