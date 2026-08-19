import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function DetailRail({ className, ...props }: ComponentProps<'aside'>) {
  return (
    <aside className={cn('rounded-lg border border-border bg-surface', className)} {...props} />
  );
}
