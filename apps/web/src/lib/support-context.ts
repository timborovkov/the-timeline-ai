export const SUPPORT_SURFACES = [
  'app_home',
  'timeline',
  'work',
  'tasks',
  'approvals',
  'boards',
  'board_detail',
  'objects',
  'object_detail',
  'documents',
  'document_detail',
  'meetings',
  'meeting_detail',
  'calendar',
  'chat',
  'search',
  'sources',
  'inbox',
  'digests',
  'personal_connections',
  'personal_mcp',
  'team',
  'team_integrations',
  'team_integration_audit',
  'team_mcp',
  'team_mcp_share',
  'team_jobs',
  'team_audit',
  'team_reconciliation',
  'team_slack',
  'team_telegram',
] as const;

export type SupportSurface = (typeof SUPPORT_SURFACES)[number];

const supportSurfaceSet = new Set<string>(SUPPORT_SURFACES);
const errorReferencePattern = /^[a-zA-Z0-9._:-]{1,128}$/;

const surfacePaths: Record<SupportSurface, string> = {
  app_home: '/app',
  timeline: '/app/timeline',
  work: '/app/work',
  tasks: '/app/tasks',
  approvals: '/app/approvals',
  boards: '/app/boards',
  board_detail: '/app/boards/:id',
  objects: '/app/objects',
  object_detail: '/app/objects/:id',
  documents: '/app/documents',
  document_detail: '/app/documents/:id',
  meetings: '/app/meetings',
  meeting_detail: '/app/meetings/:id',
  calendar: '/app/calendar',
  chat: '/app/chat',
  search: '/app/search',
  sources: '/app/sources',
  inbox: '/app/inbox',
  digests: '/app/digests',
  personal_connections: '/app/me/connections',
  personal_mcp: '/app/me/mcp-servers',
  team: '/app/team',
  team_integrations: '/app/team/integrations',
  team_integration_audit: '/app/team/integrations/audit',
  team_mcp: '/app/team/mcp-servers',
  team_mcp_share: '/app/team/mcp-share',
  team_jobs: '/app/team/jobs',
  team_audit: '/app/team/audit',
  team_reconciliation: '/app/team/reconciliation',
  team_slack: '/app/team/slack',
  team_telegram: '/app/team/telegram',
};

export function parseSupportSurface(value: unknown): SupportSurface | null {
  return typeof value === 'string' && supportSurfaceSet.has(value)
    ? (value as SupportSurface)
    : null;
}

export function parseErrorReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return errorReferencePattern.test(candidate) ? candidate : null;
}

export function supportSurfacePath(surface: SupportSurface): string {
  return surfacePaths[surface];
}

export function supportSurfaceForPath(pathname: string | null): SupportSurface | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'app') return null;
  if (segments.length === 1) return 'app_home';

  const [section, detail, nested] = segments.slice(1);
  switch (section) {
    case 'timeline':
    case 'work':
    case 'tasks':
    case 'approvals':
    case 'calendar':
    case 'chat':
    case 'search':
    case 'sources':
    case 'inbox':
    case 'digests':
      return section;
    case 'boards':
      return detail ? 'board_detail' : 'boards';
    case 'objects':
    case 'entities':
      return detail && detail !== 'new' && detail !== 'merge' ? 'object_detail' : 'objects';
    case 'documents':
      return detail && detail !== 'captured' ? 'document_detail' : 'documents';
    case 'meetings':
      return detail ? 'meeting_detail' : 'meetings';
    case 'me':
      return detail === 'connections'
        ? 'personal_connections'
        : detail === 'mcp-servers'
          ? 'personal_mcp'
          : null;
    case 'team':
      if (!detail) return 'team';
      if (detail === 'integrations') {
        return nested === 'audit' ? 'team_integration_audit' : 'team_integrations';
      }
      if (detail === 'mcp-servers') return 'team_mcp';
      if (detail === 'mcp-share') return 'team_mcp_share';
      if (detail === 'jobs') return 'team_jobs';
      if (detail === 'audit') return 'team_audit';
      if (detail === 'reconciliation') return 'team_reconciliation';
      if (detail === 'slack') return 'team_slack';
      if (detail === 'telegram') return 'team_telegram';
      return 'team';
    default:
      return null;
  }
}

export function supportRequestHref(pathname: string | null, errorReference?: string): string {
  const query = new URLSearchParams();
  const surface = supportSurfaceForPath(pathname);
  const safeReference = parseErrorReference(errorReference);
  if (surface) {
    query.set('surface', surface);
    if (safeReference) query.set('error', safeReference);
  }
  const serialized = query.toString();
  return serialized ? `/help/support?${serialized}` : '/help/support';
}
