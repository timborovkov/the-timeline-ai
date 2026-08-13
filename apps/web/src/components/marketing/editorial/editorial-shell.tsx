import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { EDITORIAL_PUBLICATION_NAME } from '@/components/marketing/editorial/content';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { PublicNavigationDisclosure, PublicNavigationItems } from '@/components/public-navigation';
import { SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';

export function EditorialShell({
  children,
  currentSection,
}: {
  children: ReactNode;
  currentSection: 'record' | 'guides';
}) {
  return (
    <div className={`${styles.canvas} min-h-dvh text-fg`}>
      <SkipLink />
      <header className={`${styles.masthead} sticky top-0 z-50 border-b border-border`}>
        <div className="mx-auto grid min-h-14 max-w-[94rem] grid-cols-[auto_1fr_auto] items-center gap-3 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="The Timeline home"
              className="w-fit shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Wordmark compact />
            </Link>
            <span
              className="hidden truncate border-l border-border pl-3 font-mono text-[0.65rem] tracking-[0.12em] text-fg-dim uppercase xl:block"
              aria-hidden="true"
            >
              {EDITORIAL_PUBLICATION_NAME} / {currentSection === 'record' ? 'Publication' : 'Guide'}
            </span>
          </div>
          <nav aria-label="Public navigation" className="hidden justify-self-center lg:block">
            <PublicNavigationItems
              currentSection="guides"
              listClassName="flex items-center gap-1"
              itemClassName="inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-medium text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              activeItemClassName="bg-surface-2 text-fg"
            />
          </nav>
          <div className="flex items-center justify-end gap-1">
            <PublicNavigationDisclosure currentSection="guides" className="lg:hidden" />
            <GitHubSourceLink
              compact
              className="hidden border-0 bg-transparent hover:bg-surface-2 xl:inline-flex"
            />
            <ThemeToggle className="text-fg-muted hover:text-fg" />
            <Link
              href="/sign-in"
              className="hidden min-h-10 items-center rounded-sm border border-border px-3 text-sm font-medium text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:inline-flex"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-border bg-bg">
        <div className="mx-auto grid max-w-[94rem] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end lg:px-10">
          <div>
            <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
              {EDITORIAL_PUBLICATION_NAME} / A provisional name
            </p>
            <p className="mt-3 max-w-xl text-sm text-fg-muted">
              Field notes from The Timeline on evidence, operational memory, and the work behind
              cited answers.
            </p>
          </div>
          <div className="grid gap-4 text-sm md:justify-items-end">
            <nav aria-label="Explore The Timeline">
              <PublicNavigationItems
                currentSection="guides"
                listClassName="flex flex-wrap gap-x-5 gap-y-3"
                itemClassName="rounded-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                activeItemClassName="text-signal"
              />
            </nav>
            <nav aria-label="Editorial footer" className="flex flex-wrap gap-x-5 gap-y-3">
              <Link
                href="/privacy"
                className="rounded-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Privacy
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 rounded-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Open Timeline <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
