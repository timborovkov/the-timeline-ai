import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return <EditorialShell currentSection="guides">{children}</EditorialShell>;
}
