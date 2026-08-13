import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/logo';
import { GitHubSourceLink } from '@/components/github-source-link';
import { EDITORIAL_PUBLICATION_NAME, RECORD_ROUTE } from '@/components/marketing/editorial/content';
import styles from '@/components/marketing/editorial/editorial.module.css';
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
        <div className="mx-auto grid h-14 max-w-[94rem] grid-cols-[1fr_auto] items-center gap-4 px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-10">
          <Link
            href="/"
            aria-label="The Timeline home"
            className="w-fit rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Wordmark compact />
          </Link>
          <Link
            href={RECORD_ROUTE}
            className="hidden rounded-sm font-mono text-[0.68rem] tracking-[0.14em] text-fg-muted uppercase outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:block"
          >
            {EDITORIAL_PUBLICATION_NAME} / Public notes
          </Link>
          <nav aria-label="Editorial" className="flex items-center justify-end gap-1">
            <Link
              href={RECORD_ROUTE}
              aria-current={currentSection === 'record' ? 'page' : 'location'}
              className="rounded-sm px-3 py-2 text-sm font-medium outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {EDITORIAL_PUBLICATION_NAME}
            </Link>
            <Link
              href="/help"
              className="hidden rounded-sm px-3 py-2 text-sm text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:block"
            >
              Help
            </Link>
            <GitHubSourceLink compact className="border-0 bg-transparent hover:bg-surface-2" />
            <ThemeToggle className="text-fg-muted hover:text-fg" />
          </nav>
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
          <nav aria-label="Editorial footer" className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
            <Link
              href={RECORD_ROUTE}
              className="rounded-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              All records
            </Link>
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
      </footer>
    </div>
  );
}
