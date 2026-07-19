'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';
import { HELP_NAV } from '@/lib/help-content';
import { cn } from '@/lib/utils';

interface HelpShellProps {
  children: ReactNode;
  isSignedIn: boolean;
}

export function HelpShell({ children, isSignedIn }: HelpShellProps) {
  const currentPath = usePathname();

  return (
    <PublicShell isSignedIn={isSignedIn} footerLabel="The Timeline help">
      <div className="mx-auto grid max-w-6xl min-w-0 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <nav className="flex w-full max-w-full gap-2 overflow-x-auto border-b border-border pb-3 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:pb-0">
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
    </PublicShell>
  );
}
