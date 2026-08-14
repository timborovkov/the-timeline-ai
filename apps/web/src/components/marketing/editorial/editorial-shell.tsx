import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export function EditorialShell({
  children,
  isSignedIn = false,
  width = 'wide',
}: {
  children: ReactNode;
  isSignedIn?: boolean;
  width?: 'wide' | 'expanded';
}) {
  return (
    <PublicShell
      isSignedIn={isSignedIn}
      width={width}
      currentSection="how-it-works"
      footerLabel="How Timeline works"
    >
      {children}
    </PublicShell>
  );
}
