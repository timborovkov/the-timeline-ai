import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { CommandBar } from '@/components/command-bar';
import { InspectorProvider } from '@/components/inspector-context';
import { InspectorPane } from '@/components/inspector-pane';
import { InspectorToggle } from '@/components/inspector-pane';
import { MobileNav } from '@/components/mobile-nav';
import { RailNav } from '@/components/rail-nav';
import { SkipLink } from '@/components/skip-link';
import { TeamSwitcher } from '@/components/team-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
  user: { name?: string | null; email?: string | null };
  children: ReactNode;
}

/**
 * Operational Archive v2 shell. Three columns:
 *   • 56px icon rail (mobile: hamburger sheet)
 *   • main column with persistent ⌘K command bar
 *   • collapsible 384px right inspector pane (hidden by default, opens
 *     when a citation chip / object reference is activated)
 */
export function AppShell({ active, memberships, recipientInvites, user, children }: Props) {
  return (
    <InspectorProvider>
      <SkipLink />
      <div className="flex min-h-screen w-full bg-bg">
        {/* ── Left rail (desktop) ─────────────────────────────────── */}
        <TooltipProvider>
          <aside
            aria-label="Sidebar"
            className="sticky top-0 hidden h-screen w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-3 md:flex"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  aria-label="The Timeline"
                  className="grid size-7 place-items-center rounded-sm font-mono text-[11px] font-bold text-signal"
                >
                  ▦
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">The Timeline</TooltipContent>
            </Tooltip>
            <RailNav role={active.role} />
            <div className="mt-auto flex flex-col items-center gap-1">
              <TeamSwitcher
                active={active}
                memberships={memberships}
                recipientInvites={recipientInvites}
                variant="rail"
              />
            </div>
          </aside>
        </TooltipProvider>

        {/* ── Main column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur md:px-4">
            <div className="flex items-center gap-2 md:hidden">
              <MobileNav
                active={active}
                memberships={memberships}
                recipientInvites={recipientInvites}
              />
              <span className="font-mono text-xs uppercase tracking-[0.14em] text-fg">
                The Timeline
              </span>
            </div>
            <CommandBar
              hint={active.teamName ? `team · ${active.teamName}` : undefined}
              className="hidden md:flex"
            />
            <div className="ml-auto flex items-center gap-1">
              <InspectorToggle />
              <ThemeToggle />
              <UserMenu user={user} />
            </div>
          </header>
          {/* Main content area. No artificial max-width: pages opt into
              <ProseContainer> for long-form text; operational surfaces
              (timeline, board, objects) fill the column. */}
          <main id="main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
            {children}
          </main>
        </div>

        {/* ── Inspector pane (desktop, collapsible) ───────────────── */}
        <InspectorPane />
      </div>
    </InspectorProvider>
  );
}
