'use client';

import { BookOpen, ExternalLink, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { NavBadgeMap } from '@/components/nav-items';
import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';

import { Logo, Wordmark } from '@/components/brand/logo';
import { RailNav } from '@/components/rail-nav';
import { TeamSwitcher } from '@/components/team-switcher';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
  badges?: NavBadgeMap;
}

const EMPTY_BADGES: NavBadgeMap = {};
const SIDEBAR_STORAGE_KEY = 'timeline.sidebar.expanded';

function readStoredExpanded(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeStoredExpanded(expanded: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(expanded));
  } catch {
    // Storage can be blocked; the in-memory toggle should still work.
  }
}

export function DesktopSidebar({
  active,
  memberships,
  recipientInvites,
  badges = EMPTY_BADGES,
}: Props) {
  const [expanded, setExpanded] = useState(readStoredExpanded);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === SIDEBAR_STORAGE_KEY) {
        setExpanded(event.newValue !== 'false');
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      writeStoredExpanded(next);
      return next;
    });
  }

  return (
    <aside
      aria-label="Sidebar"
      data-expanded={expanded}
      className={cn(
        'sticky top-0 hidden h-full shrink-0 flex-col border-r border-border bg-surface py-3 transition-[width] duration-200 md:flex',
        expanded ? 'w-64 px-3' : 'w-14 items-center px-0',
      )}
    >
      <div
        className={cn(
          'flex w-full items-center gap-2',
          expanded ? 'justify-between px-1' : 'flex-col',
        )}
      >
        {expanded ? (
          <Wordmark compact className="min-w-0 flex-1 text-fg" />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="grid size-7 place-items-center">
                <Logo className="size-5 text-fg" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">The Timeline</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-pressed={expanded}
              onClick={toggleExpanded}
              className="grid size-8 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
            >
              {expanded ? (
                <PanelLeftClose aria-hidden="true" className="size-4" />
              ) : (
                <PanelLeftOpen aria-hidden="true" className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 w-full flex-1 overflow-y-auto">
        <RailNav role={active.role} expanded={expanded} badges={badges} />
      </div>

      <div
        className={cn('flex shrink-0 flex-col gap-3 pt-3', expanded ? 'w-full' : 'items-center')}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/help"
              target="_blank"
              rel="noreferrer"
              aria-label="Open help docs in a new tab"
              className={cn(
                'rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                expanded
                  ? 'flex h-9 w-full items-center gap-3 px-3 text-sm'
                  : 'grid size-9 place-items-center',
              )}
            >
              <BookOpen aria-hidden="true" className="size-4" />
              {expanded ? (
                <>
                  <span className="min-w-0 flex-1 truncate">Help</span>
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                </>
              ) : null}
            </Link>
          </TooltipTrigger>
          {!expanded ? <TooltipContent side="right">Help docs</TooltipContent> : null}
        </Tooltip>
        <TeamSwitcher
          active={active}
          memberships={memberships}
          recipientInvites={recipientInvites}
          variant={expanded ? 'full' : 'rail'}
        />
      </div>
    </aside>
  );
}
