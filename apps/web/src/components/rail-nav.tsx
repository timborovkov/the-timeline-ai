'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { TeamMembership } from '@/lib/active-team';

import {
  formatNavBadge,
  isNavItemActive,
  navItemAccessibleLabel,
  type NavBadgeMap,
  visibleNavGroups,
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
      id="desktop-primary-navigation"
      aria-label="Primary"
      className={cn('mt-4 flex min-h-0 flex-col', expanded ? 'w-full gap-5' : 'items-center gap-3')}
    >
      {visibleNavGroups(role).map((group, groupIndex) => (
        <div key={group.id} className="w-full">
          {expanded ? (
            <p
              aria-hidden="true"
              className="mb-1 px-3 text-xs font-medium leading-[1.35] text-fg-dim"
            >
              {group.label}
            </p>
          ) : groupIndex > 0 ? (
            <div aria-hidden="true" className="mx-auto mb-3 h-px w-5 bg-border" />
          ) : null}
          <ul
            aria-label={group.label}
            className={cn(
              'flex list-none flex-col gap-1 p-0',
              expanded ? 'w-full' : 'items-center',
            )}
          >
            {group.items.map((item) => {
              const active = isNavItemActive(item, pathname);
              const Icon = item.icon;
              const badge = formatNavBadge(item.badgeKey ? badges[item.badgeKey] : undefined);
              return (
                <li key={item.href} className={expanded ? 'w-full' : undefined}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        aria-label={navItemAccessibleLabel(item.label, badge)}
                        aria-current={active ? 'page' : undefined}
                        data-current={active ? 'true' : undefined}
                        className={cn(
                          'relative rounded-sm transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                          expanded
                            ? 'flex h-9 w-full items-center gap-3 px-3 text-sm'
                            : 'grid size-9 place-items-center',
                          active
                            ? 'bg-surface-2 font-medium text-signal'
                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="absolute start-0 top-1.5 h-6 w-0.5 bg-signal"
                          />
                        ) : null}
                        <Icon aria-hidden="true" className="size-4" />
                        {expanded ? (
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        ) : null}
                        {badge ? (
                          <span
                            aria-hidden="true"
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
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
