import {
  Box,
  CalendarDays,
  CheckSquare,
  CircleCheckBig,
  Clock,
  FolderOpen,
  Inbox,
  KanbanSquare,
  MessageSquare,
  Settings,
  Video,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of truth for the primary app navigation.
 *
 * Both the desktop rail ([rail-nav.tsx](./rail-nav.tsx)) and the mobile
 * slide-over ([mobile-nav.tsx](./mobile-nav.tsx)) read from this list
 * so the two experiences can't drift. If you add a new top-level route, add
 * it here once.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app/timeline', label: 'Timeline', icon: Clock },
  { href: '/app/chat', label: 'Chat', icon: MessageSquare },
  { href: '/app/objects', label: 'Objects', icon: Box },
  { href: '/app/documents', label: 'Documents', icon: FolderOpen },
  { href: '/app/meetings', label: 'Meetings', icon: Video },
  { href: '/app/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/app/approvals', label: 'Approvals', icon: CircleCheckBig },
  { href: '/app/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/app/boards', label: 'Boards', icon: KanbanSquare },
  { href: '/app/inbox', label: 'Inbox', icon: Inbox },
  { href: '/app/team', label: 'Team', icon: Settings },
] as const;

export function visibleNavItems(role: 'owner' | 'admin' | 'member'): readonly NavItem[] {
  const canSeeAdminItems = role === 'owner' || role === 'admin';
  return NAV_ITEMS.filter((item) => !item.adminOnly || canSeeAdminItems);
}

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
