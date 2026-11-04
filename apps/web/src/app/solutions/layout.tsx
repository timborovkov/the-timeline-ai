import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function SolutionsLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell footerLabel="The Timeline use cases" currentSection="use-cases">
      {children}
    </PublicShell>
  );
}
