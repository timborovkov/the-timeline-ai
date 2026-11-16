import type { ReactNode } from 'react';

import { PublicFooter } from '@/components/public-footer';
import { PublicHeader } from '@/components/public-header';
import { type PublicNavigationSection } from '@/components/public-navigation';
import publicSiteStyles from '@/components/public-site.module.css';
import { SkipLink } from '@/components/skip-link';
import { cn } from '@/lib/utils';

interface PublicShellProps {
  children: ReactNode;
  showAccountActions?: boolean;
  width?: 'reading' | 'wide' | 'expanded';
  footerLabel?: string;
  currentSection?: PublicNavigationSection;
}

export function PublicShell({
  children,
  showAccountActions = true,
  width = 'wide',
  currentSection,
}: PublicShellProps) {
  const widthClass =
    width === 'reading' ? 'max-w-4xl' : width === 'expanded' ? 'max-w-[82rem]' : 'max-w-6xl';
  return (
    <div className={cn(publicSiteStyles.canvas, 'min-h-dvh overflow-x-hidden text-fg')}>
      <SkipLink />
      <PublicHeader currentSection={currentSection} showAccountActions={showAccountActions} />
      {children}
      <PublicFooter
        currentSection={currentSection}
        showAccountActions={showAccountActions}
        widthClassName={widthClass}
      />
    </div>
  );
}
