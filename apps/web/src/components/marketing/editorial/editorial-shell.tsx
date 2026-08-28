import type { PublicNavigationSection } from '@/components/public-navigation';
import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';

export function EditorialShell({
  children,
  isSignedIn = false,
  width = 'wide',
  currentSection = 'how-it-works',
  footerLabel = 'How Timeline works',
}: {
  children: ReactNode;
  isSignedIn?: boolean;
  width?: 'wide' | 'expanded';
  currentSection?: PublicNavigationSection;
  footerLabel?: string;
}) {
  return (
    <PublicShell
      isSignedIn={isSignedIn}
      width={width}
      currentSection={currentSection}
      footerLabel={footerLabel}
    >
      {children}
    </PublicShell>
  );
}
