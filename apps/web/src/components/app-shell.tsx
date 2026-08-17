import { Search } from 'lucide-react';
import Link from 'next/link';

import type { NavBadgeMap } from '@/components/nav-items';
import type { RecipientInvite } from '@/components/team-switcher';
import type { TeamMembership } from '@/lib/active-team';
import type { ReactNode } from 'react';

import { AppDocumentScrollLock } from '@/components/app-document-scroll-lock';
import { AppMainScrollRestoration } from '@/components/app-shell-scroll-restoration';
import { DesktopSidebar } from '@/components/desktop-sidebar';
import { GlobalSearchPalette } from '@/components/global-search-palette';
import { InboxBell, type InboxBellNotification } from '@/components/inbox/inbox-bell';
import { InspectorProvider } from '@/components/inspector-context';
import { InspectorPane } from '@/components/inspector-pane';
import { InspectorToggle } from '@/components/inspector-pane';
import { MobileNav } from '@/components/mobile-nav';
import { SkipLink } from '@/components/skip-link';
import { TeamSetupChecklistChip } from '@/components/team-setup-checklist-chip';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
import { APP_MAIN_SCROLL_ID } from '@/lib/app-scroll';

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
  sidebarInitiallyExpanded: boolean;
  workspaceTimezone: string;
  children: ReactNode;
}

const EMPTY_BADGES: NavBadgeMap = {};
const EMPTY_INBOX = { unreadCount: 0, notifications: [] };

/**
 * Quiet Archive shell. Three columns:
 *   • foldable desktop sidebar (mobile: hamburger sheet)
 *   • main column with persistent ⌘K global search palette
 *   • collapsible right inspector pane (hidden by default, opens
 *     when a citation chip / object reference is activated; up to 40%
 *     of the shell on desktop, bottom sheet on mobile)
 */
export function AppShell({
  active,
  memberships,
  recipientInvites,
  user,
  badges = EMPTY_BADGES,
  inbox = EMPTY_INBOX,
  sidebarInitiallyExpanded,
  workspaceTimezone,
  children,
}: Props) {
  return (
    <WorkspaceTimezoneProvider timezone={workspaceTimezone}>
      <InspectorProvider>
        <AppDocumentScrollLock />
        <SkipLink />
        <div className="flex h-dvh w-full overflow-hidden bg-bg">
          {/* ── Left rail (desktop) ─────────────────────────────────── */}
          <TooltipProvider>
            <DesktopSidebar
              active={active}
              memberships={memberships}
              recipientInvites={recipientInvites}
              badges={badges}
              initialExpanded={sidebarInitiallyExpanded}
            />
          </TooltipProvider>

          {/* ── Main column ─────────────────────────────────────────── */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur md:px-4">
              <div className="flex items-center gap-2 md:hidden">
                <MobileNav
                  active={active}
                  memberships={memberships}
                  recipientInvites={recipientInvites}
                  badges={badges}
                />
                <span className="text-sm font-semibold tracking-tight text-fg">The Timeline</span>
              </div>
              <GlobalSearchPalette
                hint={active.teamName ? `team · ${active.teamName}` : undefined}
                className="hidden md:block"
              />
              <div className="ml-auto flex items-center gap-1">
                <Link
                  href="/app/search"
                  aria-label="Open search"
                  className="grid size-9 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg md:hidden"
                >
                  <Search aria-hidden="true" className="size-4" />
                </Link>
                <InboxBell unreadCount={inbox.unreadCount} notifications={inbox.notifications} />
                <TeamSetupChecklistChip />
                <InspectorToggle />
                <ThemeToggle />
                <UserMenu user={user} />
              </div>
            </header>
            {/* Every app route shares one frame so page headers and content do
              not shift horizontally during navigation. Pages may constrain
              an inner prose region, but not their outer frame. */}
            <main
              id={APP_MAIN_SCROLL_ID}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-24 pt-6 md:px-8 md:py-8"
            >
              <AppMainScrollRestoration />
              <div
                data-slot="app-page-container"
                className="app-page-container mx-auto w-full max-w-6xl"
              >
                {children}
              </div>
            </main>
          </div>

          {/* ── Inspector pane (desktop, collapsible) ───────────────── */}
          <InspectorPane />
        </div>
      </InspectorProvider>
    </WorkspaceTimezoneProvider>
  );
}
