import Link from 'next/link';

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

  return (
    <nav
      aria-label="Team settings"
      className={cn(
        'w-full max-w-full overflow-x-auto border-b border-border lg:w-52 lg:shrink-0 lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-4',
        className,
      )}
    >
      <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
        {visibleItems.map((item) => {
          const active = item.value === activeSection;
          return (
            <Link
              key={item.value}
              href={`${basePath}?section=${encodeURIComponent(item.value)}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-sm px-3 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                active && 'bg-surface-2 text-fg',
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
