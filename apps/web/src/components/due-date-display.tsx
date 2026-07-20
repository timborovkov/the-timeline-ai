'use client';

import { presentDueDate } from '@timeline/shared/time';

import type { DueDatePresentation } from '@timeline/shared/time';

import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { cn } from '@/lib/utils';

type DueDateDisplayVariant = 'stacked' | 'compact' | 'inline' | 'field-hint';

interface DueDateDisplayProps {
  value: Date | string | null | undefined;
  timezone?: string;
  now?: Date;
  locale?: string;
  variant?: DueDateDisplayVariant;
  className?: string;
}

const TONE_CLASS: Record<DueDatePresentation['tone'], string> = {
  danger: 'text-danger',
  signal: 'text-signal',
  neutral: 'text-fg-muted',
  muted: 'text-fg-dim',
};

/**
 * The single user-facing due-date renderer. It preserves calendar-date meaning,
 * always includes a readable state, and shows the exact localized date whenever
 * one exists.
 */
export function DueDateDisplay({
  value,
  timezone,
  now,
  locale,
  variant = 'inline',
  className,
}: DueDateDisplayProps) {
  const workspaceTimezone = useWorkspaceTimezone();
  const due = presentDueDate(value, {
    timezone: timezone ?? workspaceTimezone,
    ...(now ? { now } : {}),
    ...(locale ? { locale } : {}),
  });
  const tone = TONE_CLASS[due.tone];

  if (due.status === 'invalid') {
    return (
      <span className={cn('text-xs', tone, className)} data-due-status={due.status}>
        {due.compactText}
      </span>
    );
  }

  if (variant === 'stacked') {
    return (
      <span className={cn('text-xs', tone, className)} data-due-status={due.status}>
        <span className="block font-medium">{due.label}</span>
        {due.dateLabel ? <span className="mt-0.5 block tabular-nums">{due.dateLabel}</span> : null}
      </span>
    );
  }

  if (variant === 'compact') {
    return (
      <span className={cn('text-xs tabular-nums', tone, className)} data-due-status={due.status}>
        {due.compactText}
      </span>
    );
  }

  return (
    <span
      className={cn(variant === 'field-hint' ? 'text-xs' : 'text-sm', tone, className)}
      data-due-status={due.status}
    >
      <span>{due.label}</span>
      {due.dateLabel ? (
        <>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{due.dateLabel}</span>
        </>
      ) : null}
    </span>
  );
}
