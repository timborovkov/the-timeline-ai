import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Shared object/task Properties rail field chrome (design.md Linear density). */
const RAIL_SECTION_LABEL = 'px-2 text-xs font-medium text-fg-dim';
const RAIL_FIELD_LABEL = 'w-[6.75rem] shrink-0 text-xs font-normal leading-4 text-fg-dim';
export const RAIL_FIELD_VALUE =
  'min-w-0 flex-1 bg-transparent text-sm font-normal leading-5 text-fg outline-none placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-signal/50';
const RAIL_ROW = 'group flex min-h-8 items-center gap-2 px-2';
export const RAIL_QUIET_ACTION =
  'inline-flex min-h-8 items-center gap-1.5 px-2 text-xs font-normal text-fg-muted transition-colors hover:text-fg disabled:opacity-50';
export const RAIL_UNDERLINE_CONTROL =
  'h-8 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-fg outline-none placeholder:text-fg-dim focus-visible:border-signal';
export const RAIL_GHOST_ICON_BUTTON = cn(
  'grid size-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors',
  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
  'hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:opacity-50',
);

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
