'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';

import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';

import { RailNav } from '@/components/rail-nav';
import { TeamSwitcher } from '@/components/team-switcher';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
}

const SIDEBAR_STORAGE_KEY = 'timeline.sidebar.expanded';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

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

export function DesktopSidebar({ active, memberships, recipientInvites }: Props) {
  const [expanded, setExpanded] = useState(true);

  useBrowserLayoutEffect(() => {
    setExpanded(readStoredExpanded());
  }, []);

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
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface py-3 transition-[width] duration-200 md:flex',
        expanded ? 'w-64 px-3' : 'w-14 items-center px-0',
      )}
    >
      <div
        className={cn(
          'flex w-full items-center gap-2',
          expanded ? 'justify-between px-1' : 'flex-col',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label="The Timeline"
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-sm font-mono text-[11px] font-bold text-signal',
                expanded && 'border border-border bg-bg',
              )}
            >
              ▦
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">The Timeline</TooltipContent>
        </Tooltip>

        {expanded ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-[0.14em] text-fg">
            The Timeline
          </span>
        ) : null}

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

      <RailNav role={active.role} expanded={expanded} />

      <div className={cn('mt-auto flex flex-col gap-1', expanded ? 'w-full' : 'items-center')}>
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
