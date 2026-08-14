import type { ReactNode } from 'react';

import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';
import { auth } from '@/lib/auth';

export default async function HowItWorksLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <EditorialShell isSignedIn={Boolean(session?.user)} width="expanded">
      {children}
    </EditorialShell>
  );
}
