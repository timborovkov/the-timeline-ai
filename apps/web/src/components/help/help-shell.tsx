import Link from 'next/link';

import type { ReactNode } from 'react';

import { Logo, Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { HELP_NAV } from '@/lib/help-content';
import { cn } from '@/lib/utils';

interface HelpShellProps {
  children: ReactNode;
  isSignedIn: boolean;
  currentPath?: string;
}

export function HelpShell({ children, isSignedIn, currentPath }: HelpShellProps) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="The Timeline home" className="hidden text-fg sm:block">
            <Wordmark compact />
          </Link>
          <Link href="/" aria-label="The Timeline home" className="text-fg sm:hidden">
            <Logo className="size-7" />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="hidden px-3 py-2 text-fg-muted transition-colors hover:text-fg md:inline"
            >
              Landing
            </Link>
            {isSignedIn ? (
              <Link href="/app/timeline" className="px-3 py-2 text-fg-muted hover:text-fg">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="px-3 py-2 text-fg-muted hover:text-fg">
                  Sign in
                </Link>
                <Button asChild size="sm">
                  <Link href="/sign-up">Sign up</Link>
                </Button>
              </>
            )}
            <ThemeToggle className="text-fg-muted hover:text-fg" />
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="flex gap-2 overflow-x-auto border-b border-border pb-3 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:pb-0">
            {HELP_NAV.map(({ href, label, icon: Icon }) => {
              const active = currentPath === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-2 rounded-sm px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:flex',
                    active && 'bg-surface-2 text-fg',
                  )}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main id="main" className="min-w-0 pb-16">
          {children}
        </main>
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>The Timeline help</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="hover:text-fg">
              Landing
            </Link>
            <Link href="/help/support" className="hover:text-fg">
              Support
            </Link>
            {isSignedIn ? (
              <Link href="/app/timeline" className="hover:text-fg">
                Dashboard
              </Link>
            ) : (
              <Link href="/sign-in" className="hover:text-fg">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
