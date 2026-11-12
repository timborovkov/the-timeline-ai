import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function DetailRail({ className, ...props }: ComponentProps<'aside'>) {
  return (
    <aside className={cn('rounded-lg border border-border bg-surface', className)} {...props} />
  );
}

export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-start gap-3">
      <span className="pt-2.5 text-xs leading-5 text-fg-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
