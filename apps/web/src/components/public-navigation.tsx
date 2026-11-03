'use client';

import { ChevronDown, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { USE_CASE_NAV_ITEMS } from '@/components/marketing/copy';
import styles from '@/components/public-navigation.module.css';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const PUBLIC_NAVIGATION_ITEMS = [
  { section: 'product', href: '/', label: 'Product' },
  {
    section: 'use-cases',
    href: '/use-cases',
    label: 'Use cases',
    analyticsCta: 'view_use_cases',
    children: USE_CASE_NAV_ITEMS,
  },
  {
    section: 'integrations',
    href: '/integrations',
    label: 'Integrations',
    analyticsCta: 'view_integrations',
  },
  { section: 'pricing', href: '/pricing', label: 'Pricing', analyticsCta: 'view_pricing' },
  {
    section: 'how-it-works',
    href: '/how-it-works',
    label: 'How it works',
    analyticsCta: 'view_how_it_works',
  },
  { section: 'trust', href: '/trust', label: 'Trust' },
  { section: 'help', href: '/help', label: 'Help' },
] as const;

export type PublicNavigationSection = (typeof PUBLIC_NAVIGATION_ITEMS)[number]['section'];

interface PublicNavigationItemsProps {
  currentSection?: PublicNavigationSection;
  listClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  onNavigate?: () => void;
  variant?: 'menu' | 'simple' | 'footer';
}

export function PublicNavigationItems({
  currentSection,
  listClassName,
  itemClassName,
  activeItemClassName,
  onNavigate,
  variant = 'menu',
}: PublicNavigationItemsProps) {
  return (
    <ul className={listClassName}>
      {PUBLIC_NAVIGATION_ITEMS.map((item) => {
        const active = currentSection === item.section;
        const analyticsCta = 'analyticsCta' in item ? item.analyticsCta : undefined;
        if ('children' in item && variant === 'menu') {
          return (
            <UseCasesMenu
              key={item.section}
              href={item.href}
              label={item.label}
              childrenItems={item.children}
              active={active}
              itemClassName={itemClassName}
              activeItemClassName={activeItemClassName}
              analyticsCta={analyticsCta}
              onNavigate={onNavigate}
            />
          );
        }

        return (
          <li key={item.section}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(itemClassName, active && activeItemClassName)}
              data-public-analytics-cta={analyticsCta}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
            {variant === 'footer' && 'children' in item ? (
              <ul className={cn(styles.footerUseCases, 'mt-2')}>
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link href={child.href} className={itemClassName} onClick={onNavigate}>
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function UseCasesMenu({
  href,
  label,
  childrenItems,
  active,
  itemClassName,
  activeItemClassName,
  analyticsCta,
  onNavigate,
}: {
  href: string;
  label: string;
  childrenItems: readonly { href: string; label: string }[];
  active: boolean;
  itemClassName?: string;
  activeItemClassName?: string;
  analyticsCta?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  return (
    <li className={styles.dropdown}>
      <details ref={detailsRef} className="group">
        <summary
          className={cn(styles.dropdownSummary, itemClassName, active && activeItemClassName)}
        >
          {label}
          <ChevronDown aria-hidden="true" className="size-3.5 opacity-70 group-open:rotate-180" />
        </summary>
        <div className={styles.dropdownPanel}>
          <ul className={styles.dropdownList}>
            <li>
              <Link
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(itemClassName, 'w-full')}
                data-public-analytics-cta={analyticsCta}
                onClick={onNavigate}
              >
                All use cases
              </Link>
            </li>
            {childrenItems.map((child) => (
              <li key={child.href}>
                <Link
                  href={child.href}
                  className={cn(itemClassName, 'w-full')}
                  onClick={onNavigate}
                >
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </li>
  );
}

export function PublicFooterUseCaseLinks({
  className,
  itemClassName,
}: {
  className?: string;
  itemClassName?: string;
}) {
  return (
    <ul className={cn(styles.footerUseCases, className)}>
      {USE_CASE_NAV_ITEMS.map((item) => (
        <li key={item.href}>
          <Link href={item.href} className={itemClassName}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PublicNavigationDisclosure({
  currentSection,
  className,
  showAccountActions = true,
}: {
  currentSection?: PublicNavigationSection;
  className?: string;
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
        <MobileNavigationItems currentSection={currentSection} onNavigate={closeDisclosure} />
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border px-3 pt-2">
          {showAccountActions ? (
            <PublicSessionBranch
              signedOut={
                <Link
                  href="/sign-in"
                  data-public-analytics-cta="sign_in"
                  onClick={closeDisclosure}
                  className="flex min-h-11 items-center rounded-sm text-sm font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  Sign in
                </Link>
              }
              signedIn={<span className="text-sm font-medium text-fg-muted">Appearance</span>}
            />
          ) : (
            <span className="text-sm font-medium text-fg-muted">Appearance</span>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </details>
  );
}

function MobileNavigationItems({
  currentSection,
  onNavigate,
}: {
  currentSection?: PublicNavigationSection;
  onNavigate: () => void;
}) {
  return (
    <ul className="grid gap-1">
      {PUBLIC_NAVIGATION_ITEMS.map((item) => {
        const active = currentSection === item.section;
        const linkClass =
          'flex min-h-11 items-center rounded-sm px-3 text-sm font-medium text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
        return (
          <li key={item.section}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(linkClass, active && 'bg-surface-2 text-fg')}
              data-public-analytics-cta={'analyticsCta' in item ? item.analyticsCta : undefined}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
            {'children' in item ? (
              <ul className={styles.nestedList}>
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link href={child.href} className={linkClass} onClick={onNavigate}>
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
