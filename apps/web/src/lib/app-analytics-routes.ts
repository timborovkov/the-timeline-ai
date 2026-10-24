import type { AppSurface } from '@timeline/shared/analytics';

const STATIC_APP_ROUTES = Object.freeze({
  '/app': 'home',
  '/app/timeline': 'timeline',
  '/app/work': 'work',
  '/app/tasks': 'tasks',
  '/app/approvals': 'approvals',
  '/app/boards': 'boards',
  '/app/objects': 'objects',
  '/app/objects/new': 'objects',
  '/app/objects/merge': 'objects',
  '/app/entities': 'objects',
  '/app/documents': 'documents',
  '/app/documents/captured': 'documents',
  '/app/meetings': 'meetings',
  '/app/calendar': 'calendar',
  '/app/chat': 'chat',
  '/app/search': 'search',
  '/app/sources': 'sources',
  '/app/inbox': 'inbox',
  '/app/digests': 'digests',
  '/app/me/connections': 'personal_connections',
  '/app/me/mcp-servers': 'personal_mcp',
  '/app/team': 'team_overview',
  '/app/team/audit': 'team_audit',
  '/app/team/integrations': 'team_integrations',
  '/app/team/integrations/audit': 'team_integrations',
  '/app/team/jobs': 'team_jobs',
  '/app/team/mcp-servers': 'team_mcp',
  '/app/team/mcp-share': 'team_share',
  '/app/team/reconciliation': 'team_reconciliation',
  '/app/team/slack': 'team_slack',
  '/app/team/telegram': 'team_telegram',
} satisfies Readonly<Record<string, AppSurface>>);

export function classifyAppAnalyticsPath(pathname: string): AppSurface | undefined {
  if (
    !pathname.startsWith('/app') ||
    pathname.includes('?') ||
    pathname.includes('#') ||
    pathname.includes('\\') ||
    pathname.endsWith('/')
  ) {
    return undefined;
  }

  if (Object.hasOwn(STATIC_APP_ROUTES, pathname)) {
    return STATIC_APP_ROUTES[pathname as keyof typeof STATIC_APP_ROUTES];
  }

  const segments = pathname.split('/');
  if (segments.length === 4 && segments[1] === 'app') {
    if (segments[2] === 'boards') return 'board_detail';
    if (segments[2] === 'objects' || segments[2] === 'entities') return 'object_detail';
    if (segments[2] === 'documents') return 'document_detail';
    if (segments[2] === 'meetings') return 'meeting_detail';
  }
  if (
    segments.length === 6 &&
    segments[1] === 'app' &&
    segments[2] === 'team' &&
    segments[3] === 'reconciliation' &&
    segments[4] === 'clusters'
  ) {
    return 'team_reconciliation';
  }
  return undefined;
}
