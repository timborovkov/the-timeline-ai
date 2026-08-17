import type { ReactNode } from 'react';

export function CollectionRowLeading({ children }: { children?: ReactNode }) {
  return <div className="flex min-h-10 shrink-0 items-center">{children}</div>;
}
