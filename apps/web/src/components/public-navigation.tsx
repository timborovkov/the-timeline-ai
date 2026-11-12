'use client';

import { ChevronDown, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import {
  COMPARE_NAV_ITEMS,
  INTEGRATION_NAV_ITEMS,
  USE_CASE_NAV_ITEMS,
  publicNavItemLabel,
} from '@/components/marketing/copy';
import styles from '@/components/public-navigation.module.css';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const HEADER_NAVIGATION_ITEMS = [
  { section: 'product', href: '/', label: 'Product' },
  {
    section: 'use-cases',
    href: '/use-cases',
    label: 'Use cases',
    analyticsCta: 'view_use_cases',
    overviewLabel: 'All use cases',
    children: USE_CASE_NAV_ITEMS,
  },
  {
    section: 'integrations',
    href: '/integrations',
    label: 'Integrations',
    analyticsCta: 'view_integrations',
    overviewLabel: 'Integrations hub',
    children: INTEGRATION_NAV_ITEMS,
  },
  { section: 'agents', href: '/agents', label: 'Agents', analyticsCta: 'view_agents' },
  { section: 'pricing', href: '/pricing', label: 'Pricing', analyticsCta: 'view_pricing' },
] as const;

const FOOTER_PRODUCT_ITEMS = [
  { href: '/', label: 'Product', section: 'product' as const },
  {
    href: '/how-it-works',
    label: 'How it works',
    section: 'how-it-works' as const,
    analyticsCta: 'view_how_it_works',
  },
  {
    href: '/pricing',
    label: 'Pricing',
    section: 'pricing' as const,
    analyticsCta: 'view_pricing',
  },
  {
    href: '/agents',
    label: 'Agents',
    section: 'agents' as const,
    analyticsCta: 'view_agents',
  },
  { href: '/help', label: 'Help', section: 'help' as const },
] as const;

export type PublicNavigationSection =
  | (typeof HEADER_NAVIGATION_ITEMS)[number]['section']
  | (typeof FOOTER_PRODUCT_ITEMS)[number]['section']
  | 'compare'
  | 'trust';

interface NavChild {
  href: string;
  label: string;
  statusLabel?: string;
  group?: 'agent-tools';
}

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
      {HEADER_NAVIGATION_ITEMS.map((item) => {
        const active = currentSection === item.section;
        const analyticsCta = 'analyticsCta' in item ? item.analyticsCta : undefined;
        if ('children' in item) {
          return (
            <NavDropdown
              key={item.section}
              href={item.href}
              label={item.label}
              overviewLabel={item.overviewLabel}
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
          </li>
        );
      })}
    </ul>
  );
}

function NavDropdown({
  href,
  label,
  overviewLabel,
  childrenItems,
  active,
  itemClassName,
  activeItemClassName,
  analyticsCta,
  onNavigate,
  nested = false,
}: {
  href: string;
  label: string;
  overviewLabel: string;
  childrenItems: readonly NavChild[];
  active: boolean;
  itemClassName?: string;
  activeItemClassName?: string;
  analyticsCta?: string;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const node = detailsRef.current;
    if (!node) return;

    const closeIfOutside = (event: PointerEvent) => {
      if (!node.open) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      node.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.open) return;
      node.open = false;
    };

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <li className={nested ? styles.mobileDropdown : styles.dropdown}>
      <details ref={detailsRef}>
        <summary
          className={cn(styles.dropdownSummary, itemClassName, active && activeItemClassName)}
        >
          {label}
          <ChevronDown aria-hidden="true" className={styles.dropdownChevron} />
        </summary>
        <div className={styles.dropdownPanel}>
          <ul className={styles.dropdownList}>
            <li>
              <Link
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(styles.dropdownLink, styles.dropdownOverview, itemClassName)}
                data-public-analytics-cta={analyticsCta}
                onClick={onNavigate}
              >
                {overviewLabel}
              </Link>
            </li>
            <li role="separator" className={styles.dropdownRule} />
            {childrenItems.flatMap((child, index) => {
              const previous = childrenItems[index - 1];
              const items = [];
              if (child.group && child.group !== previous?.group) {
                items.push(
                  <li
                    key={`${child.href}-rule`}
                    role="separator"
                    className={styles.dropdownRule}
                  />,
                );
              }
              items.push(
                <li key={child.href}>
                  <Link
                    href={child.href}
                    className={cn(styles.dropdownLink, itemClassName)}
                    onClick={onNavigate}
                  >
                    {publicNavItemLabel(child)}
                  </Link>
                </li>,
              );
              return items;
            })}
          </ul>
        </div>
      </details>
    </li>
  );
}

export function PublicFooterColumns({
  currentSection,
  className,
  headingClassName,
  itemClassName,
  activeItemClassName,
  legalItems,
}: {
  currentSection?: PublicNavigationSection;
  className?: string;
  headingClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  legalItems: ReactNode;
}) {
  return (
    <div className={cn(styles.footerColumns, className)}>
      <section aria-label="Product">
        <p className={cn(styles.footerColumnTitle, headingClassName)}>Product</p>
        <ul className={styles.footerColumnList}>
          {FOOTER_PRODUCT_ITEMS.map((item) => (
            <li key={item.href}>
              <FooterNavLink
                href={item.href}
                label={item.label}
                active={currentSection === item.section}
                itemClassName={itemClassName}
                activeItemClassName={activeItemClassName}
                analyticsCta={'analyticsCta' in item ? item.analyticsCta : undefined}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Use cases">
        <p className={cn(styles.footerColumnTitle, headingClassName)}>Use cases</p>
        <ul className={styles.footerColumnList}>
          <li>
            <FooterNavLink
              href="/use-cases"
              label="All use cases"
              active={currentSection === 'use-cases'}
              itemClassName={itemClassName}
              activeItemClassName={activeItemClassName}
              analyticsCta="view_use_cases"
            />
          </li>
          {USE_CASE_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <FooterNavLink
                href={item.href}
                label={item.label}
                itemClassName={itemClassName}
                activeItemClassName={activeItemClassName}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Integrations">
        <p className={cn(styles.footerColumnTitle, headingClassName)}>Integrations</p>
        <ul className={styles.footerColumnList}>
          <li>
            <FooterNavLink
              href="/integrations"
              label="Integrations hub"
              active={currentSection === 'integrations'}
              itemClassName={itemClassName}
              activeItemClassName={activeItemClassName}
              analyticsCta="view_integrations"
            />
          </li>
          {INTEGRATION_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <FooterNavLink
                href={item.href}
                label={publicNavItemLabel(item)}
                itemClassName={itemClassName}
                activeItemClassName={activeItemClassName}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Compare">
        <p className={cn(styles.footerColumnTitle, headingClassName)}>Compare</p>
        <ul className={styles.footerColumnList}>
          <li>
            <FooterNavLink
              href="/compare"
              label="Compare hub"
              active={currentSection === 'compare'}
              itemClassName={itemClassName}
              activeItemClassName={activeItemClassName}
              analyticsCta="view_compare"
            />
          </li>
          {COMPARE_NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <FooterNavLink
                href={item.href}
                label={item.label}
                itemClassName={itemClassName}
                activeItemClassName={activeItemClassName}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Support and legal">
        <p className={cn(styles.footerColumnTitle, headingClassName)}>Legal</p>
        <ul className={styles.footerColumnList}>{legalItems}</ul>
      </section>
    </div>
  );
}

function FooterNavLink({
  href,
  label,
  active = false,
  itemClassName,
  activeItemClassName,
  analyticsCta,
}: {
  href: string;
  label: string;
  active?: boolean;
  itemClassName?: string;
  activeItemClassName?: string;
  analyticsCta?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(itemClassName, active && activeItemClassName)}
      data-public-analytics-cta={analyticsCta}
    >
      {label}
    </Link>
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
    const closeOnEscape = (event: KeyboardEvent) => {
      const disclosure = disclosureRef.current;
      if (event.key !== 'Escape' || !disclosure?.open) return;
      disclosure.open = false;
      disclosure.querySelector('summary')?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (disclosureRef.current) disclosureRef.current.open = false;
  }, [pathname]);

  return (
    <details ref={disclosureRef} className={cn('relative', className)}>
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
  const linkClass =
    'flex min-h-11 items-center rounded-sm px-3 text-sm font-medium text-fg-muted outline-none hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

  return (
    <ul className="grid gap-1">
      {HEADER_NAVIGATION_ITEMS.map((item) => {
        const active = currentSection === item.section;
        if ('children' in item) {
          return (
            <NavDropdown
              key={item.section}
              href={item.href}
              label={item.label}
              overviewLabel={item.overviewLabel}
              childrenItems={item.children}
              active={active}
              itemClassName={cn(linkClass, active && 'bg-surface-2 text-fg')}
              analyticsCta={'analyticsCta' in item ? item.analyticsCta : undefined}
              onNavigate={onNavigate}
              nested
            />
          );
        }

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
          </li>
        );
      })}
    </ul>
  );
}
