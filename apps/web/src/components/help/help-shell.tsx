'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { PublicShell } from '@/components/public-shell';
import { HELP_NAV } from '@/lib/help-content';
import { cn } from '@/lib/utils';

interface HelpShellProps {
  children: ReactNode;
  isSignedIn: boolean;
}

export function HelpShell({ children, isSignedIn }: HelpShellProps) {
  const currentPath = usePathname();
  const guideNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const guideNav = guideNavRef.current;

    if (!guideNav) return;

    const centerActiveGuide = () => {
      const activeGuide = guideNav.querySelector<HTMLAnchorElement>('[aria-current="page"]');
      if (!activeGuide) return;
      if (guideNav.scrollWidth <= guideNav.clientWidth) return;

      const activeRect = activeGuide.getBoundingClientRect();
      const navRect = guideNav.getBoundingClientRect();
      const centeredScrollLeft =
        guideNav.scrollLeft +
        activeRect.left -
        navRect.left -
        (guideNav.clientWidth - activeRect.width) / 2;
      const maxScrollLeft = guideNav.scrollWidth - guideNav.clientWidth;

      guideNav.scrollLeft = Math.min(maxScrollLeft, Math.max(0, centeredScrollLeft));
    };

    centerActiveGuide();
    const frame = window.requestAnimationFrame(centerActiveGuide);
    window.addEventListener('resize', centerActiveGuide);

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(centerActiveGuide);
    if (resizeObserver) {
      resizeObserver.observe(guideNav);
      for (const guide of guideNav.children) resizeObserver.observe(guide);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', centerActiveGuide);
      resizeObserver?.disconnect();
    };
  }, [currentPath]);

  return (
    <PublicShell isSignedIn={isSignedIn} footerLabel="The Timeline help" currentSection="help">
      <div className="mx-auto grid max-w-6xl min-w-0 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_1fr]">
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <nav
            ref={guideNavRef}
            aria-label="Help guides"
            className="flex w-full max-w-full gap-2 overflow-x-auto border-b border-border pb-3 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:pb-0"
          >
            {HELP_NAV.map(({ href, label, icon: Icon }) => {
              const active =
                currentPath === href ||
                (href === '/help/support' && currentPath === '/help/contact');
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'inline-flex h-9 shrink-0 items-center gap-2 rounded-sm px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:flex',
                    active && 'bg-surface-2 text-fg',
                  )}
                  aria-current={active ? 'page' : undefined}
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
