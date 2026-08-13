import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import {
  PublicNavigationDisclosure,
  PublicNavigationItems,
  type PublicNavigationSection,
} from '@/components/public-navigation';
import { SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PublicShellProps {
  children: ReactNode;
  isSignedIn?: boolean;
  width?: 'reading' | 'wide';
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
  const widthClass = width === 'reading' ? 'max-w-4xl' : 'max-w-6xl';
  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg text-fg">
      <SkipLink />
      <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
        <div
          className={cn(
            'mx-auto grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 sm:px-6',
            widthClass,
          )}
        >
          <Link
            href="/"
            aria-label="The Timeline home"
            className="whitespace-nowrap rounded-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <Wordmark compact />
          </Link>
          <nav aria-label="Public navigation" className="hidden justify-self-center lg:block">
            <PublicNavigationItems
              currentSection={currentSection}
              listClassName="flex items-center gap-1"
              itemClassName="inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-medium text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              activeItemClassName="bg-surface-2 text-fg"
            />
          </nav>
          <div className="flex items-center justify-self-end gap-1">
            <PublicNavigationDisclosure currentSection={currentSection} className="lg:hidden" />
            <GitHubSourceLink compact className="hidden xl:inline-flex" />
            <ThemeToggle className="hidden text-fg-muted hover:text-fg min-[23rem]:inline-flex" />
            <Button asChild size="sm" variant="outline">
              <Link href={isSignedIn ? '/app' : '/sign-in'}>
                {isSignedIn ? 'Open app' : 'Sign in'}
              </Link>
            </Button>
          </div>
        </div>
      </header>
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
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
