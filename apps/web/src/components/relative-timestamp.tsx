'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { formatDisplayDateTime, formatRelativeAge } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

function unsubscribeClientRender(): void {
  return undefined;
}

function subscribeClientRender(): () => void {
  return unsubscribeClientRender;
}

function clientRenderSnapshot(): boolean {
  return true;
}

function serverRenderSnapshot(): boolean {
  return false;
}

export function RelativeTimestamp({
  value,
  prefix,
  empty,
  className,
}: {
  value: Date | string | null | undefined;
  prefix?: string;
  empty?: ReactNode;
  className?: string;
}) {
  const timezone = useWorkspaceTimezone();
  const isClient = useSyncExternalStore(
    subscribeClientRender,
    clientRenderSnapshot,
    serverRenderSnapshot,
  );

  if (value === null || value === undefined || value === '') {
    return empty ? <span className={cn('text-xs text-fg-dim', className)}>{empty}</span> : null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return empty ? (
      <span className={cn('text-xs text-fg-dim', className)}>{empty}</span>
    ) : (
      <span className={cn('font-mono text-[11px] tabular-nums text-fg-dim', className)}>
        {String(value)}
      </span>
    );
  }

  const iso = date.toISOString();
  const absolute = formatDisplayDateTime(date, { timezone });
  const relative = formatRelativeAge(date);
  const visible = prefix ? `${prefix} ${relative}` : relative;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={iso}
            title={absolute}
            className={cn('font-mono text-[11px] tabular-nums text-fg-dim', className)}
          >
            {isClient ? visible : '\u00a0'}
          </time>
        </TooltipTrigger>
        <TooltipContent>{absolute}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
