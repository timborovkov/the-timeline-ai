import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

export default function PricingLayout({ children }: { children: ReactNode }) {
  return (
    <EditorialShell width="expanded" currentSection="pricing" footerLabel="Pricing">
      {children}
    </EditorialShell>
  );
}
