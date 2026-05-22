import { Box, Clock, Inbox, MessageSquare, Settings, type LucideIcon } from 'lucide-react';

/**
 * Single source of truth for the primary app navigation.
 *
 * Both the desktop sidebar ([sidebar-nav.tsx](./sidebar-nav.tsx)) and the
 * mobile slide-over ([mobile-nav.tsx](./mobile-nav.tsx)) read from this list
 * so the two experiences can't drift. If you add a new top-level route, add
 * it here once.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// `/app/boards` is intentionally omitted: the route's data layer ships in
// this PR but the UI is a Phase 8 follow-up (see todo.md). Adding the nav
// item before the page exists would send users to a 404. Reintroduce it
// alongside the boards page in the follow-up PR.
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app/timeline', label: 'Timeline', icon: Clock },
  { href: '/app/chat', label: 'Chat', icon: MessageSquare },
  { href: '/app/objects', label: 'Objects', icon: Box },
  { href: '/app/inbox', label: 'Inbox', icon: Inbox },
  { href: '/app/team', label: 'Team', icon: Settings },
] as const;

/**
 * `pathname.startsWith(`${href}/`)` would miss the exact-match case, and
 * `pathname.startsWith(href)` over-matches (`/app/team` would highlight for
 * `/app/teamfoo`). Centralised so the desktop and mobile nav can't disagree
 * on which row gets the active treatment on a deep route like
 * `/app/entities/<id>` or `/app/team/telegram`.
 */
export function isNavItemActive(item: Pick<NavItem, 'href'>, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
