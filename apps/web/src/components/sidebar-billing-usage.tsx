import Link from 'next/link';

import type { SidebarBillingSummary } from '@timeline/shared/billing';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function UsageBar({
  percent,
  atLimit,
  className,
}: {
  percent: number;
  atLimit: boolean;
  className?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-sm bg-border', className)}
      aria-hidden="true"
    >
      <div
        className={cn(
          'h-full rounded-sm transition-[width]',
          atLimit ? 'bg-danger' : 'bg-fg-muted',
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * Compact plan + usage meter for the app sidebar / mobile nav.
 * Links to Billing (admins) or Usage (members).
 */
export function SidebarBillingUsage({
  summary,
  expanded,
  className,
}: {
  summary: SidebarBillingSummary;
  expanded: boolean;
  className?: string;
}) {
  const tooltip = [summary.planName, summary.detailLabel, summary.overageLabel]
    .filter(Boolean)
    .join(' · ');

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={summary.href}
            aria-label={`Plan ${summary.planName}. ${summary.detailLabel}${summary.overageLabel ? `. ${summary.overageLabel}` : ''}. Open ${summary.canManageBilling ? 'billing' : 'usage'}.`}
            data-sidebar-billing
            data-plan={summary.planId}
            className={cn(
              'grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
              className,
            )}
          >
            <span className="relative block size-5">
              <span className="absolute inset-0 rounded-full border border-border" />
              <span
                className={cn(
                  'absolute inset-[3px] rounded-full',
                  summary.atLimit ? 'bg-danger/80' : 'bg-fg-muted/70',
                )}
                style={{
                  clipPath: `inset(${100 - Math.max(8, summary.progressPercent)}% 0 0 0)`,
                }}
              />
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={summary.href}
      data-sidebar-billing
      data-plan={summary.planId}
      aria-label={`Plan ${summary.planName}. ${summary.detailLabel}${summary.overageLabel ? `. ${summary.overageLabel}` : ''}. Open ${summary.canManageBilling ? 'billing' : 'usage'}.`}
      className={cn(
        'block w-full rounded-sm border border-border bg-bg px-3 py-2.5 transition-colors hover:bg-surface-2',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-medium text-fg">{summary.planName}</p>
        <p className="shrink-0 font-mono text-[0.65rem] text-fg-dim">{summary.progressPercent}%</p>
      </div>
      <UsageBar percent={summary.progressPercent} atLimit={summary.atLimit} className="mt-2" />
      <p className="mt-1.5 truncate text-[0.7rem] leading-4 text-fg-muted">{summary.detailLabel}</p>
      {summary.overageLabel ? (
        <p className="mt-0.5 truncate font-mono text-[0.7rem] leading-4 text-fg-dim">
          {summary.overageLabel}
        </p>
      ) : null}
    </Link>
  );
}
