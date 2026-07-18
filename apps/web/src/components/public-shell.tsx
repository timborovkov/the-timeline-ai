import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PublicShellProps {
  children: ReactNode;
  isSignedIn?: boolean;
  width?: 'reading' | 'wide';
  footerLabel?: string;
}

export function PublicShell({
  children,
  isSignedIn = false,
  width = 'wide',
  footerLabel = 'The Timeline',
}: PublicShellProps) {
  const widthClass = width === 'reading' ? 'max-w-4xl' : 'max-w-6xl';
  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-fg">
      <SkipLink />
      <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
        <div
          className={cn(
            'mx-auto flex h-12 items-center justify-between gap-4 px-4 sm:px-6',
            widthClass,
          )}
        >
          <Link href="/" aria-label="The Timeline home" className="text-fg">
            <Wordmark compact />
          </Link>
          <nav aria-label="Public" className="flex items-center gap-1 text-sm">
            <Link href="/help" className="hidden px-3 py-2 text-fg-muted hover:text-fg sm:block">
              Help
            </Link>
            <Link href="/privacy" className="hidden px-3 py-2 text-fg-muted hover:text-fg md:block">
              Privacy
            </Link>
            <ThemeToggle className="text-fg-muted hover:text-fg" />
            <Button asChild size="sm" variant="outline">
              <Link href={isSignedIn ? '/app' : '/sign-in'}>
                {isSignedIn ? 'Open app' : 'Sign in'}
              </Link>
            </Button>
          </nav>
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
          <div className="flex flex-wrap gap-4">
            <Link href="/help/support" className="hover:text-fg">
              Support
            </Link>
            <Link href="/terms" className="hover:text-fg">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-fg">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
