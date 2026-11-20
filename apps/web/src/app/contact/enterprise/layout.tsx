import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

export default function EnterpriseContactLayout({ children }: { children: ReactNode }) {
  return (
    <EditorialShell width="wide" currentSection="pricing" footerLabel="Enterprise">
      {children}
    </EditorialShell>
  );
}
