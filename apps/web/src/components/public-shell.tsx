import Link from 'next/link';

import type { ReactNode } from 'react';

import { CookieSettingsButton } from '@/components/public-analytics';
import { PublicHeader } from '@/components/public-header';
import { PublicFooterColumns, type PublicNavigationSection } from '@/components/public-navigation';
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

const FOOTER_LINK_CLASS =
  'rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function PublicShell({
  children,
  showAccountActions = true,
  width = 'wide',
  footerLabel = 'The Timeline',
  currentSection,
}: PublicShellProps) {
  const widthClass =
    width === 'reading' ? 'max-w-4xl' : width === 'expanded' ? 'max-w-[82rem]' : 'max-w-6xl';
  return (
    <div className={cn(publicSiteStyles.canvas, 'min-h-dvh overflow-x-hidden text-fg')}>
      <SkipLink />
      <PublicHeader currentSection={currentSection} showAccountActions={showAccountActions} />
      {children}
      <footer className="border-t border-border">
        <div
          className={cn(
            'mx-auto flex flex-col gap-10 px-4 py-10 text-sm text-fg-muted sm:px-6',
            widthClass,
          )}
        >
          <span>{footerLabel}</span>
          <nav aria-label="Explore The Timeline">
            <PublicFooterColumns
              currentSection={currentSection}
              itemClassName={FOOTER_LINK_CLASS}
              activeItemClassName="text-fg"
              legalItems={
                <>
                  <li>
                    <Link href="/help/support" className={FOOTER_LINK_CLASS}>
                      Support
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/trust"
                      aria-current={currentSection === 'trust' ? 'page' : undefined}
                      className={cn(FOOTER_LINK_CLASS, currentSection === 'trust' && 'text-fg')}
                    >
                      Trust
                    </Link>
                  </li>
                  <li>
                    <Link href="/terms" className={FOOTER_LINK_CLASS}>
                      Terms
                    </Link>
                  </li>
                  <li>
                    <Link href="/privacy" className={FOOTER_LINK_CLASS}>
                      Privacy
                    </Link>
                  </li>
                  <li>
                    <Link href="/cookies" className={FOOTER_LINK_CLASS}>
                      Cookies
                    </Link>
                  </li>
                  <li>
                    <CookieSettingsButton />
                  </li>
                </>
              }
            />
          </nav>
        </div>
      </footer>
    </div>
  );
}
