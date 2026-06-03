'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { TeamMembership } from '@/lib/active-team';

import {
  formatNavBadge,
  isNavItemActive,
  type NavBadgeMap,
  visibleNavItems,
} from '@/components/nav-items';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const EMPTY_BADGES: NavBadgeMap = {};

/**
 * Primary desktop navigation. In folded mode this renders the compact icon rail;
 * in expanded mode it shows the same destinations with labels.
 */
export function RailNav({
  role,
  expanded = false,
  badges = EMPTY_BADGES,
}: {
  role: TeamMembership['role'];
  expanded?: boolean;
  badges?: NavBadgeMap;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className={cn('mt-4 flex flex-col gap-1', expanded ? 'w-full' : 'items-center')}
    >
      {visibleNavItems(role).map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        const badge = formatNavBadge(item.badgeKey ? badges[item.badgeKey] : undefined);
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative rounded-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                  expanded
                    ? 'flex h-9 w-full items-center gap-3 px-3 text-sm'
                    : 'grid size-9 place-items-center',
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
                {expanded ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                {badge ? (
                  <span
                    aria-label={`${item.label} attention ${badge}`}
                    className={cn(
                      'grid min-w-5 place-items-center rounded-sm border px-1 font-mono text-[10px] leading-4',
                      active
                        ? 'border-signal/40 bg-bg text-signal'
                        : 'border-danger/40 text-danger',
                      expanded ? 'ml-auto h-5' : 'absolute -right-1 -top-1 h-4',
                    )}
                  >
                    {badge}
                  </span>
                ) : null}
              </Link>
            </TooltipTrigger>
            {!expanded ? <TooltipContent side="right">{item.label}</TooltipContent> : null}
          </Tooltip>
        );
      })}
    </nav>
  );
}
