import Link from 'next/link';

import type { ReactNode } from 'react';

import { PublicHeader } from '@/components/public-header';
import {
  PublicNavigationItems,
  type PublicNavigationSection,
} from '@/components/public-navigation';
import publicSiteStyles from '@/components/public-site.module.css';
import { SkipLink } from '@/components/skip-link';
import { cn } from '@/lib/utils';

interface PublicShellProps {
  children: ReactNode;
  isSignedIn?: boolean;
  width?: 'reading' | 'wide' | 'expanded';
  footerLabel?: string;
  currentSection?: PublicNavigationSection;
}

export function PublicShell({
  children,
  isSignedIn = false,
  width = 'wide',
  footerLabel = 'The Timeline',
  currentSection,
}: PublicShellProps) {
  const widthClass =
    width === 'reading' ? 'max-w-4xl' : width === 'expanded' ? 'max-w-[82rem]' : 'max-w-6xl';
  return (
    <div className={cn(publicSiteStyles.canvas, 'min-h-dvh overflow-x-hidden text-fg')}>
      <SkipLink />
      <PublicHeader isSignedIn={isSignedIn} currentSection={currentSection} />
      {children}
      <footer className="border-t border-border">
        <div
          className={cn(
            'mx-auto flex flex-col gap-3 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6',
            widthClass,
          )}
        >
          <span>{footerLabel}</span>
          <div className="flex flex-col gap-4 sm:items-end">
            <nav aria-label="Explore The Timeline">
              <PublicNavigationItems
                currentSection={currentSection}
                listClassName="flex flex-wrap gap-x-4 gap-y-3"
                itemClassName="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                activeItemClassName="text-fg"
              />
            </nav>
            <nav aria-label="Support and legal" className="flex flex-wrap gap-x-4 gap-y-3">
              <Link
                href="/help/support"
                className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Support
              </Link>
              <Link
                href="/trust"
                className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Trust
              </Link>
              <Link
                href="/terms"
                className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Privacy
              </Link>
              <Link
                href="/cookies"
                className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Cookies
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
