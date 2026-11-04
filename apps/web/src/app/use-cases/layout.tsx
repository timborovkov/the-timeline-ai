import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function UseCasesLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell width="expanded" footerLabel="The Timeline use cases" currentSection="use-cases">
      {children}
    </PublicShell>
  );
}
