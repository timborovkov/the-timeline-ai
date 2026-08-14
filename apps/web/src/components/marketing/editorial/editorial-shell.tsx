import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export function EditorialShell({
  children,
  isSignedIn = false,
}: {
  children: ReactNode;
  isSignedIn?: boolean;
}) {
  return (
    <PublicShell
      isSignedIn={isSignedIn}
      currentSection="how-it-works"
      footerLabel="How Timeline works"
    >
      {children}
    </PublicShell>
  );
}
