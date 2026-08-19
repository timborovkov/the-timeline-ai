'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import type { ReactNode } from 'react';

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
  const activeItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeSection]);

  return (
    <div className={cn('space-y-2', className)}>
      <nav
        aria-label="Team settings"
        className="w-full max-w-full snap-x snap-mandatory overflow-x-auto scroll-px-3 border-b border-border lg:w-52 lg:shrink-0 lg:snap-none lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-4"
      >
        <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
          {visibleItems.map((item) => {
            const active = item.value === activeSection;
            return (
              <Link
                key={item.value}
                ref={active ? activeItemRef : undefined}
                href={`${basePath}?section=${encodeURIComponent(item.value)}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 shrink-0 snap-start touch-manipulation items-center gap-2 rounded-sm px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset lg:min-h-8',
                  active &&
                    'bg-surface-2 font-medium text-fg lg:shadow-[inset_2px_0_0_var(--color-signal)]',
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <p aria-hidden="true" className="text-xs text-fg-dim lg:sr-only">
        Swipe or scroll to see more settings.
      </p>
    </div>
  );
}
