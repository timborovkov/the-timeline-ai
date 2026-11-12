import type { ReactNode } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';

export function TeamListRow({ children }: { children: ReactNode }) {
  return (
    <li className="@container/member">
      <CollectionRow className="grid-cols-[auto_minmax(0,1fr)] @min-[32rem]/member:grid-cols-[auto_minmax(0,1fr)_auto] [&>[data-slot=collection-row-actions]]:flex-wrap [&>[data-slot=collection-row-actions]]:gap-2 [&>[data-slot=collection-row-actions]]:col-start-2 [&>[data-slot=collection-row-actions]]:pb-3 @min-[32rem]/member:[&>[data-slot=collection-row-actions]]:col-auto @min-[32rem]/member:[&>[data-slot=collection-row-actions]]:pb-0">
        {children}
      </CollectionRow>
    </li>
  );
}
