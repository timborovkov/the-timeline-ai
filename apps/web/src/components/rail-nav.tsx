'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { NAV_ITEMS, isNavItemActive } from '@/components/nav-items';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * 56px-wide icon rail. Operational Archive v2 replacement for the old
 * 256px sidebar. Each item is an icon-only anchor with a Radix tooltip
 * surfacing the label; active route shows a 2px signal-color left bar +
 * signal text. Expects a TooltipProvider higher in the tree.
 */
export function RailNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="mt-4 flex flex-col items-center gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative grid size-9 place-items-center rounded-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-surface-2 text-signal'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1.5 h-6 w-0.5 bg-signal"
                  />
                ) : null}
                <Icon aria-hidden="true" className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
