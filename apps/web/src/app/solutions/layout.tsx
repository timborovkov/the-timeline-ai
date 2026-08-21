import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';
import { auth } from '@/lib/auth';

export default async function SolutionsLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  return (
    <PublicShell
      isSignedIn={Boolean(session?.user)}
      footerLabel="Timeline solutions"
      currentSection="product"
    >
      {children}
    </PublicShell>
  );
}
