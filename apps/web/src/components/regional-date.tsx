'use client';

import { useRegionalFormat } from '@/components/workspace-timezone-context';
import {
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayDateParts,
} from '@/lib/display-dates';

export function RegionalDate({
  value,
  variant = 'date',
  className,
  timezone,
  parts,
}: {
  value: Date | string;
  className?: string;
  timezone?: string;
  parts?: Intl.DateTimeFormatOptions;
  variant?: 'date' | 'datetime' | 'month';
}) {
  const region = useRegionalFormat();
  const options = { ...region, timezone: timezone ?? region.timezone };
  const formatted = parts
    ? formatDisplayDateParts(value, options, parts)
    : variant === 'datetime'
      ? formatDisplayDateTime(value, options)
      : variant === 'month'
        ? formatDisplayDateParts(value, options, { month: 'long', year: 'numeric' })
        : formatDisplayDate(value, options);
  return (
    <time
      className={className}
      dateTime={
        value instanceof Date
          ? Number.isFinite(value.getTime())
            ? value.toISOString()
            : undefined
          : value
      }
    >
      {formatted}
    </time>
  );
}
