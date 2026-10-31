import Link from 'next/link';

import type { BillingNudge } from '@timeline/shared/billing/status';

import { cn } from '@/lib/utils';

/** One line and one action. Admins only; members use the cap notice. */
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
        'flex items-center justify-between gap-3 border border-border bg-surface-2 px-3 py-2',
        className,
      )}
    >
      <p className="min-w-0 truncate text-sm text-fg">{nudge.title}</p>
      <Link
        href={nudge.href}
        className="shrink-0 text-sm font-medium text-fg underline-offset-4 hover:underline"
      >
        {nudge.ctaLabel}
      </Link>
    </output>
  );
}
