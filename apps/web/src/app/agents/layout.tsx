import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export default function AgentsLayout({ children }: { children: ReactNode }) {
  return (
    <PublicShell width="wide" footerLabel="Agents" currentSection="agents">
      {children}
    </PublicShell>
  );
}
