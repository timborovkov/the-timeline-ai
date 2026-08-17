import {
  Cable,
  Clock,
  Files,
  LayoutDashboard,
  LibraryBig,
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
type NavGroupId = 'overview' | 'workspace' | 'manage';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: NavGroupId;
  activeHrefs?: readonly string[];
  badgeKey?: keyof NavBadgeMap;
  adminOnly?: boolean;
}

export interface NavItemGroup {
  id: NavGroupId;
  label: string;
  items: readonly NavItem[];
}

export interface NavBadgeMap {
  work?: number;
  connections?: number;
}

const NAV_GROUPS: readonly Pick<NavItemGroup, 'id' | 'label'>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'manage', label: 'Manage' },
] as const;

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app', label: 'Home', icon: LayoutDashboard, group: 'overview' },
  { href: '/app/timeline', label: 'Timeline', icon: Clock, group: 'overview' },
  { href: '/app/chat', label: 'Ask', icon: MessageSquare, group: 'overview' },
  {
    href: '/app/work',
    label: 'Work',
    icon: LibraryBig,
    group: 'workspace',
    badgeKey: 'work',
    activeHrefs: [
      '/app/work',
      '/app/objects',
      '/app/tasks',
      '/app/boards',
      '/app/calendar',
      '/app/digests',
      '/app/approvals',
    ],
  },
  {
    href: '/app/documents',
    label: 'Documents',
    icon: Files,
    group: 'workspace',
    activeHrefs: ['/app/documents', '/app/documents/'],
  },
  {
    href: '/app/meetings',
    label: 'Meetings',
    icon: Video,
    group: 'workspace',
  },
  {
    href: '/app/sources',
    label: 'Connections',
    icon: Cable,
    group: 'manage',
    badgeKey: 'connections',
    activeHrefs: [
      '/app/sources',
      '/app/team/telegram',
      '/app/team/slack',
      '/app/team/integrations',
      '/app/team/mcp-servers',
      '/app/team/mcp-share',
      '/app/me/connections',
      '/app/me/mcp-servers',
    ],
  },
  {
    href: '/app/team',
    label: 'Team',
    icon: Settings,
    group: 'manage',
    activeHrefs: ['/app/team', '/app/team/audit', '/app/team/jobs', '/app/team/reconciliation'],
  },
] as const;

export function visibleNavItems(role: 'owner' | 'admin' | 'member'): readonly NavItem[] {
  const canSeeAdminItems = role === 'owner' || role === 'admin';
  return NAV_ITEMS.filter((item) => !item.adminOnly || canSeeAdminItems);
}

export function visibleNavGroups(role: 'owner' | 'admin' | 'member'): readonly NavItemGroup[] {
  const itemsByGroup: Record<NavGroupId, NavItem[]> = {
    overview: [],
    workspace: [],
    manage: [],
  };
  for (const item of visibleNavItems(role)) {
    itemsByGroup[item.group].push(item);
  }

  const groups: NavItemGroup[] = [];
  for (const group of NAV_GROUPS) {
    const items = itemsByGroup[group.id];
    if (items.length > 0) groups.push({ ...group, items });
  }
  return groups;
}

export function formatNavBadge(value: number | undefined): string | null {
  if (!value || value <= 0) return null;
  return value > 99 ? '99+' : String(value);
}

export function navItemAccessibleLabel(label: string, badge: string | null): string {
  if (!badge) return label;
  return `${label}, ${badge} ${badge === '1' ? 'item needs' : 'items need'} attention`;
}

/**
 * `pathname.startsWith(`${href}/`)` would miss the exact-match case, and
 * `pathname.startsWith(href)` over-matches (`/app/team` would highlight for
 * `/app/teamfoo`). Centralised so the desktop and mobile nav can't disagree
 * on which row gets the active treatment on a deep route like
 * `/app/entities/<id>` or `/app/team/telegram`.
 */
export function isNavItemActive(
  item: Pick<NavItem, 'href' | 'activeHrefs'>,
  pathname: string,
): boolean {
  const hrefs = item.activeHrefs ?? [item.href];
  return hrefs.some((href) => {
    if (href === '/app') return pathname === '/app';
    if (item.activeHrefs && href === item.href) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}
