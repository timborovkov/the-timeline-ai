import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

export default function RecordLayout({ children }: { children: ReactNode }) {
  return <EditorialShell currentSection="record">{children}</EditorialShell>;
}
