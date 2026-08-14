import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function MarketingContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-[82rem] px-4 sm:px-6', className)}>{children}</div>
  );
}

export function MarketingSectionGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]',
        className,
      )}
    >
      {children}
    </div>
  );
}
