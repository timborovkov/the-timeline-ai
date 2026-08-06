import Link from 'next/link';

import type { ReactNode } from 'react';

import { LandingSkipLink } from '@/app/(landing)/_landing-skip-link';
import { Logo, Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';

const CONTACT_HREF = '/help/support';

export function LandingRecoveryShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <div className="relative z-[60]">
        <LandingSkipLink />
      </div>
      <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <Link
            href="/"
            aria-label="The Timeline home"
            className="shrink-0 rounded-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Logo ariaHidden className="size-5 sm:hidden" />
            <Wordmark compact className="hidden sm:inline-flex" />
          </Link>
          <nav aria-label="Landing navigation" className="flex items-center gap-1 text-sm">
            <Link
              href="/help"
              className="hidden rounded-sm px-3 py-2 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline"
            >
              Docs
            </Link>
            <Link
              href={CONTACT_HREF}
              className="rounded-sm px-3 py-2 text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Contact
            </Link>
            <ThemeToggle className="text-fg-muted hover:text-fg" />
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border px-4 py-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
          <span className="inline-flex items-center gap-2 text-fg-dim">
            <Logo ariaHidden className="size-4" />
            THE TIMELINE
          </span>
          <nav aria-label="Landing footer" className="flex flex-wrap items-center gap-5">
            <Link
              href="/help"
              className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Docs
            </Link>
            <Link
              href="/terms"
              className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Privacy
            </Link>
            <Link
              href={CONTACT_HREF}
              className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Contact
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
