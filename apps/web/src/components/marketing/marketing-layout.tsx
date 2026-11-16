import type { ReactNode } from 'react';

import styles from '@/components/marketing/public-page.module.css';
import { cn } from '@/lib/utils';

export function MarketingContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-marketing-container
      className={cn('mx-auto w-full min-w-0 max-w-6xl px-4 sm:px-6', styles.container, className)}
    >
      {children}
    </div>
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
      data-marketing-section
      className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 [&>*]:min-w-0', className)}
    >
      {children}
    </div>
  );
}
