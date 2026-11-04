import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell width="expanded" footerLabel="Agents" currentSection="agents">
      {children}
    </PublicShell>
  );
}
