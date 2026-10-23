import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** One short customer billing state, with at most one action. */
export function BillingStateBanner({
  title,
  children,
  className,
}: {
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-billing-banner
      className={cn(
        'flex items-center justify-between gap-3 border border-border bg-surface-2 px-3 py-2',
        className,
      )}
    >
      <p className="text-sm text-fg">{title}</p>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}
