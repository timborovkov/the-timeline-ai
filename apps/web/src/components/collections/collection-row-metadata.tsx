import type { ReactNode } from 'react';

export function CollectionRowMetadata({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 sm:ml-auto sm:flex-nowrap sm:justify-end">
      {children}
    </div>
  );
}
