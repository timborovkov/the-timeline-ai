import Link from 'next/link';

import { cn } from '@/lib/utils';

/** Quiet gray enterprise contact line — not a fifth plan column. */
export function PricingEnterpriseNudge({ className }: { className?: string }) {
  return (
    <p
      data-pricing-enterprise-nudge
      className={cn(
        'border border-border bg-surface-2/80 px-4 py-3 text-sm leading-6 text-fg-muted',
        className,
      )}
    >
      Need governance, procurement, committed volume, or an SLA?{' '}
      <Link
        href="/help/support"
        className="text-fg-muted underline decoration-border underline-offset-4 hover:text-fg"
      >
        Contact us for a custom Enterprise plan
      </Link>
      .
    </p>
  );
}
