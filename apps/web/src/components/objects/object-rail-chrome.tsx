import type { ComponentProps, ReactNode } from 'react';

import {
  RAIL_FIELD_LABEL,
  RAIL_ROW,
  RAIL_SECTION_LABEL,
} from '@/components/objects/object-rail-tokens';
import { cn } from '@/lib/utils';

export function ObjectRailRow({
  label,
  htmlFor,
  className,
  children,
  action,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn(RAIL_ROW, className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={RAIL_FIELD_LABEL} title={label}>
          {label}
        </label>
      ) : (
        <span className={RAIL_FIELD_LABEL} title={label}>
          {label}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      {action}
    </div>
  );
}

export function ObjectRailSection({
  label,
  children,
  className,
  ...props
}: ComponentProps<'section'> & { label: string }) {
  return (
    <section className={cn('flex flex-col gap-0.5 py-0.5', className)} {...props}>
      <h2 className={RAIL_SECTION_LABEL}>{label}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}
