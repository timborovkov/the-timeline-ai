import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

export default function HowItWorksLayout({ children }: { children: ReactNode }) {
  return <EditorialShell width="expanded">{children}</EditorialShell>;
}
