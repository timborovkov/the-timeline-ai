import type { ReactNode } from 'react';

export function CollectionToolbarSearch({ children }: { children?: ReactNode }) {
  return <div className="min-w-48 flex-1 sm:max-w-sm">{children}</div>;
}
