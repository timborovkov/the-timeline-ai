import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function CompareLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell width="expanded" footerLabel="Compare" currentSection="compare">
      {children}
    </PublicShell>
  );
}
