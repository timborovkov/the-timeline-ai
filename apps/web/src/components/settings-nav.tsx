'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { ScrollableNav } from '@/components/scrollable-nav';
import { cn } from '@/lib/utils';

interface SettingsNavItem {
  value: string;
  label: string;
  icon?: ReactNode;
  adminOnly?: boolean;
}

interface SettingsNavProps {
  items: SettingsNavItem[];
  activeSection: string;
  isAdmin?: boolean;
  basePath?: string;
  className?: string;
}

export function SettingsNav({
  items,
  activeSection,
  isAdmin = false,
  basePath = '/app/team',
  className,
}: SettingsNavProps) {
  const visibleItems = items.filter((item) => !item.adminOnly || isAdmin);

  return (
    <div className={cn('min-w-0', className)}>
      <ScrollableNav
        activeKey={activeSection}
        label="Team settings"
        cue="Swipe or scroll to see more settings."
        className="w-full scroll-px-3 border-b border-border lg:w-52 lg:shrink-0 lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-4"
        itemsClassName="lg:min-w-0 lg:flex-col"
      >
        {visibleItems.map((item) => {
          const active = item.value === activeSection;
          return (
            <Link
              key={item.value}
              href={`${basePath}?section=${encodeURIComponent(item.value)}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 shrink-0 touch-manipulation items-center gap-2 rounded-sm px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:min-h-8',
                active &&
                  'bg-surface-2 font-medium text-fg lg:shadow-[inset_2px_0_0_var(--color-signal)]',
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </ScrollableNav>
    </div>
  );
}
