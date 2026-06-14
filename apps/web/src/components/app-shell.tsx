import { Search } from 'lucide-react';
import Link from 'next/link';

import type { NavBadgeMap } from '@/components/nav-items';
import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { CommandBar } from '@/components/command-bar';
import { DesktopSidebar } from '@/components/desktop-sidebar';
import { InboxBell, type InboxBellNotification } from '@/components/inbox/inbox-bell';
import { InspectorProvider } from '@/components/inspector-context';
import { InspectorPane } from '@/components/inspector-pane';
import { InspectorToggle } from '@/components/inspector-pane';
import { MobileNav } from '@/components/mobile-nav';
import { SkipLink } from '@/components/skip-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
  user: { name?: string | null; email?: string | null; emailVerified?: Date | string | null };
  badges?: NavBadgeMap;
  inbox?: {
    unreadCount: number;
    notifications: InboxBellNotification[];
  };
  children: ReactNode;
}

const EMPTY_BADGES: NavBadgeMap = {};
const EMPTY_INBOX = { unreadCount: 0, notifications: [] };

/**
 * Operational Archive v2 shell. Three columns:
 *   • foldable desktop sidebar (mobile: hamburger sheet)
 *   • main column with persistent ⌘K command bar
 *   • collapsible 384px right inspector pane (hidden by default, opens
 *     when a citation chip / object reference is activated)
 */
export function AppShell({
  active,
  memberships,
  recipientInvites,
  user,
  badges = EMPTY_BADGES,
  inbox = EMPTY_INBOX,
  children,
}: Props) {
  return (
    <InspectorProvider>
      <SkipLink />
      <div className="flex min-h-screen w-full bg-bg">
        {/* ── Left rail (desktop) ─────────────────────────────────── */}
        <TooltipProvider>
          <DesktopSidebar
            active={active}
            memberships={memberships}
            recipientInvites={recipientInvites}
            badges={badges}
          />
        </TooltipProvider>

        {/* ── Main column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur md:px-4">
            <div className="flex items-center gap-2 md:hidden">
              <MobileNav
                active={active}
                memberships={memberships}
                recipientInvites={recipientInvites}
                badges={badges}
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
              <Link
                href="/app/timeline"
                aria-label="Open search"
                className="grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
              >
                <Search aria-hidden="true" className="size-4" />
              </Link>
              <InboxBell unreadCount={inbox.unreadCount} notifications={inbox.notifications} />
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
