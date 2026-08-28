'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const PUBLIC_NAVIGATION_ITEMS = [
  { section: 'product', href: '/', label: 'Product' },
  { section: 'integrations', href: '/integrations', label: 'Integrations' },
  { section: 'pricing', href: '/pricing', label: 'Pricing' },
  { section: 'how-it-works', href: '/how-it-works', label: 'How it works' },
  { section: 'help', href: '/help', label: 'Help' },
] as const;

export type PublicNavigationSection = (typeof PUBLIC_NAVIGATION_ITEMS)[number]['section'];

interface PublicNavigationItemsProps {
  currentSection?: PublicNavigationSection;
  listClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  onNavigate?: () => void;
}

export function PublicNavigationItems({
  currentSection,
  listClassName,
  itemClassName,
  activeItemClassName,
  onNavigate,
}: PublicNavigationItemsProps) {
  return (
    <ul className={listClassName}>
      {PUBLIC_NAVIGATION_ITEMS.map((item) => {
        const active = currentSection === item.section;
        return (
          <li key={item.section}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(itemClassName, active && activeItemClassName)}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PublicNavigationDisclosure({
  currentSection,
  className,
  isSignedIn = false,
  showAccountActions = true,
}: {
  currentSection?: PublicNavigationSection;
  className?: string;
  isSignedIn?: boolean;
  showAccountActions?: boolean;
}) {
  const pathname = usePathname();
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const closeDisclosure = () => {
    if (disclosureRef.current) disclosureRef.current.open = false;
  };

  useEffect(() => {
    if (disclosureRef.current) disclosureRef.current.open = false;
  }, [pathname]);

  return (
    <details ref={disclosureRef} className={cn('group relative', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm border border-border bg-bg px-3 text-sm font-medium text-fg outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg [&::-webkit-details-marker]:hidden">
        <Menu aria-hidden="true" className="size-4" />
        <span>Menu</span>
      </summary>
      <nav
        aria-label="Public navigation menu"
        className="fixed top-16 right-4 z-50 max-h-[calc(100dvh-5rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border bg-bg p-2 shadow-lg"
      >
        <PublicNavigationItems
          currentSection={currentSection}
          listClassName="grid gap-1"
          itemClassName="flex min-h-11 items-center rounded-sm px-3 text-sm font-medium text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          activeItemClassName="bg-surface-2 text-fg"
          onNavigate={closeDisclosure}
        />
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border px-3 pt-2">
          {showAccountActions && !isSignedIn ? (
            <Link
              href="/sign-in"
              onClick={closeDisclosure}
              className="flex min-h-11 items-center rounded-sm text-sm font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Sign in
            </Link>
          ) : (
            <span className="text-sm font-medium text-fg-muted">Appearance</span>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </details>
  );
}
