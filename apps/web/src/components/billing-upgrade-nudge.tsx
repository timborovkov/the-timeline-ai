import Link from 'next/link';

import type { BillingNudge } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

/** A short explanation and one action. Admins only; members use the cap notice. */
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
        'flex flex-wrap items-center justify-between gap-3 border border-border bg-surface-2 px-3 py-2',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{nudge.title}</p>
        <p className="mt-1 text-sm text-fg-muted">{nudge.body}</p>
      </div>
      <Link
        href={nudge.href}
        className="shrink-0 text-sm font-medium text-fg underline-offset-4 hover:underline"
      >
        {nudge.ctaLabel}
      </Link>
    </output>
  );
}
