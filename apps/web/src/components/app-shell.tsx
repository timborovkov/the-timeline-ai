import type { SidebarBillingSummary } from '@timeline/shared/billing/status';
import type { FirstRunPhase } from '@timeline/shared/onboarding/first-run';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { AppDocumentScrollLock } from '@/components/app-document-scroll-lock';
import { AppPageTransition } from '@/components/app-page-transition';
import { AppMainScrollRestoration } from '@/components/app-shell-scroll-restoration';
import { ChatViewProvider } from '@/components/chat/chat-view-context';
import { FloatingAgentChat } from '@/components/chat/floating-agent-chat';
import { ClearPlanIntent } from '@/components/clear-plan-intent';
import { DesktopSidebar } from '@/components/desktop-sidebar';
import { GlobalSearchPalette } from '@/components/global-search-palette';
import { InboxBell, type InboxBellNotification } from '@/components/inbox/inbox-bell';
import { InspectorProvider } from '@/components/inspector-context';
import { InspectorPane } from '@/components/inspector-pane';
import { InspectorToggle } from '@/components/inspector-pane';
import { MobileNav } from '@/components/mobile-nav';
import type { NavBadgeMap } from '@/components/nav-items';
import { GettingStartedStrip } from '@/components/onboarding/getting-started-strip';
import { PlanIntentPrompt } from '@/components/plan-intent-prompt';
import { RegionalDate } from '@/components/regional-date';
import { SkipLink } from '@/components/skip-link';
import { TeamSetupChecklistChip } from '@/components/team-setup-checklist-chip';
import type { RecipientInvite } from '@/components/team-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UserMenu } from '@/components/user-menu';
import { WorkNavigation } from '@/components/work-subnav';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';
import type { TeamMembership } from '@/lib/active-team';
import { APP_MAIN_SCROLL_ID } from '@/lib/app-scroll';
import type { RegionalFormat } from '@/lib/regional-format';
import type { PaidSignupPlanId } from '@/lib/signup-plan';

interface ShellInbox {
  unreadCount: number;
  notifications: InboxBellNotification[];
}

interface Props {
  active: TeamMembership;
  memberships: TeamMembership[];
  recipientInvites: RecipientInvite[];
  user: { name?: string | null; email?: string | null; emailVerified?: Date | string | null };
  badges?: NavBadgeMap | Promise<NavBadgeMap>;
  inbox?: ShellInbox | Promise<ShellInbox>;
  sidebarInitiallyExpanded: boolean;
  workspaceTimezone: string;
  region?: Partial<RegionalFormat> & { browserLocale?: string };
  billingSummary?: SidebarBillingSummary | null | Promise<SidebarBillingSummary | null>;
  platformAdmin?: boolean;
  impersonation?: { email: string; teamName: string; readOnly: boolean; expiresAt: string } | null;
  gettingStarted?: { phase: FirstRunPhase; hidden: boolean } | null;
  planIntent?: {
    planId: PaidSignupPlanId;
    title: string;
    body: string;
    ctaLabel: string;
    href: string;
  } | null;
  clearPlanIntent?: boolean;
  planIntentContent?: ReactNode;
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
  region,
  billingSummary = null,
  platformAdmin = false,
  impersonation = null,
  gettingStarted = null,
  planIntent = null,
  clearPlanIntent = false,
  planIntentContent,
  children,
}: Props) {
  return (
    <WorkspaceTimezoneProvider timezone={workspaceTimezone} region={region}>
      <ChatViewProvider>
        <InspectorProvider>
          <AppDocumentScrollLock />
          <ClearPlanIntent active={clearPlanIntent} />
          <SkipLink />
          <div className="dashboard-shell flex h-dvh w-full overflow-hidden bg-bg">
            {/* ── Left rail (desktop) ─────────────────────────────────── */}
            <TooltipProvider>
              <DesktopSidebar
                active={active}
                memberships={memberships}
                recipientInvites={recipientInvites}
                badges={badges}
                initialExpanded={sidebarInitiallyExpanded}
                billingSummary={billingSummary}
              />
            </TooltipProvider>

            {/* ── Main column ─────────────────────────────────────────── */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {impersonation && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-sm"
                >
                  <p>
                    Viewing as <strong>{impersonation.email}</strong> · {impersonation.teamName}
                    {impersonation.readOnly ? ' · Read-only' : ''} · Ends{' '}
                    <RegionalDate value={impersonation.expiresAt} variant="datetime" />
                  </p>
                  <form action="/api/platform-admin/exit" method="post">
                    <button type="submit" className="min-h-11 rounded-sm border border-border px-3">
                      Exit impersonation
                    </button>
                  </form>
                </div>
              )}
              <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-bg/90 px-3 backdrop-blur md:px-4">
                <div className="flex items-center gap-2 md:hidden">
                  <MobileNav
                    active={active}
                    memberships={memberships}
                    recipientInvites={recipientInvites}
                    badges={badges}
                    billingSummary={billingSummary}
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
                    className="grid size-11 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg md:hidden"
                  >
                    <Search aria-hidden="true" className="size-4" />
                  </Link>
                  <Suspense fallback={<div aria-hidden="true" className="size-9" />}>
                    {inbox instanceof Promise ? (
                      <ShellInboxBell inbox={inbox} />
                    ) : (
                      <InboxBell {...inbox} />
                    )}
                  </Suspense>
                  <TeamSetupChecklistChip />
                  <InspectorToggle />
                  <ThemeToggle />
                  {platformAdmin && (
                    <Link
                      href="/app/admin"
                      className="hidden px-2 py-3 text-sm hover:underline md:block"
                    >
                      Platform admin
                    </Link>
                  )}
                  <UserMenu
                    platformAdmin={platformAdmin}
                    user={user}
                    impersonating={Boolean(impersonation)}
                  />
                </div>
              </header>
              {planIntentContent}
              {planIntent ? (
                <PlanIntentPrompt
                  teamId={active.teamId}
                  planId={planIntent.planId}
                  title={planIntent.title}
                  body={planIntent.body}
                  ctaLabel={planIntent.ctaLabel}
                  href={planIntent.href}
                />
              ) : null}
              {gettingStarted ? (
                <GettingStartedStrip phase={gettingStarted.phase} hidden={gettingStarted.hidden} />
              ) : null}
              <WorkNavigation />
              {/* The shell owns a bounded content column. Collection bands can
              bleed to pane edges without stretching their inner content. */}
              <main
                id={APP_MAIN_SCROLL_ID}
                className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-24 pt-6 md:px-8 md:py-8"
              >
                <AppMainScrollRestoration />
                <AppPageTransition>{children}</AppPageTransition>
              </main>
            </div>

            {/* ── Inspector pane (desktop, collapsible) ───────────────── */}
            <InspectorPane />
            <FloatingAgentChat teamId={active.teamId} teamName={active.teamName} />
          </div>
        </InspectorProvider>
      </ChatViewProvider>
    </WorkspaceTimezoneProvider>
  );
}

async function ShellInboxBell({ inbox }: { inbox: ShellInbox | Promise<ShellInbox> }) {
  const { unreadCount, notifications } = await inbox;
  return <InboxBell unreadCount={unreadCount} notifications={notifications} />;
}
