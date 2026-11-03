import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function ProductTourLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell width="expanded" footerLabel="The Timeline product tour" currentSection="product">
      {children}
    </PublicShell>
  );
}
