import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { EDITORIAL_PUBLICATION_NAME } from '@/components/marketing/editorial/content';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { PublicHeader } from '@/components/public-header';
import { PublicNavigationItems } from '@/components/public-navigation';
import publicSiteStyles from '@/components/public-site.module.css';
import { SkipLink } from '@/components/skip-link';

export function EditorialShell({
  children,
  isSignedIn = false,
}: {
  children: ReactNode;
  isSignedIn?: boolean;
}) {
  return (
    <div className={`${publicSiteStyles.canvas} ${styles.canvas} min-h-dvh text-fg`}>
      <SkipLink />
      <PublicHeader isSignedIn={isSignedIn} currentSection="guides" />
      {children}
      <footer className="border-t border-border bg-bg">
        <div className="mx-auto grid max-w-[94rem] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] md:items-end lg:px-10">
          <div>
            <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
              {EDITORIAL_PUBLICATION_NAME} / Field notes on cited work
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
                href={isSignedIn ? '/app' : '/sign-in'}
                className="inline-flex items-center gap-2 rounded-sm outline-none hover:text-signal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {isSignedIn ? 'Dashboard' : 'Open Timeline'}{' '}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
