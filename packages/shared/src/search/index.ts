export const GLOBAL_SEARCH_KINDS = [
  'timeline_event',
  'document_chunk',
  'object',
  'task',
  'calendar_event',
  'board',
  'quick_link',
  'external_link',
] as const;

export type GlobalSearchKind = (typeof GLOBAL_SEARCH_KINDS)[number];
export type GlobalSearchMode = 'preview' | 'full';

export interface GlobalSearchScoreParts {
  semantic?: number;
  lexical?: number;
  title?: number;
  intent?: number;
  recency?: number;
  navigation?: number;
}

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchKind;
  title: string;
  snippet: string;
  href: string;
  externalHref?: string;
  score: number;
  scoreParts: GlobalSearchScoreParts;
  occurredAt?: string;
  updatedAt?: string;
  startAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GlobalSearchWarning {
  source: GlobalSearchKind | 'semantic';
  message: string;
}

export interface GlobalSearchResponse {
  ok: true;
  query: string;
  mode: GlobalSearchMode;
  results: GlobalSearchResult[];
  warnings: GlobalSearchWarning[];
}

export interface LexicalScoreInput {
  query: string;
  title: string;
  fields?: readonly (string | null | undefined)[];
  keywords?: readonly string[];
}

export interface QuickLinkSeed {
  id: string;
  kind: 'quick_link' | 'external_link';
  title: string;
  snippet: string;
  href: string;
  externalHref?: string;
  keywords: readonly string[];
  group: string;
  adminOnly?: boolean;
}

const TITLE_WEIGHT = 0.9;
const LEXICAL_WEIGHT = 0.55;
const SEMANTIC_WEIGHT = 0.82;
const INTENT_WEIGHT = 0.35;
const RECENCY_WEIGHT = 0.12;
const NAVIGATION_WEIGHT = 1.2;

export const QUICK_LINKS: readonly QuickLinkSeed[] = [
  {
    id: 'home',
    kind: 'quick_link',
    title: 'Home',
    snippet: 'Open the dashboard.',
    href: '/app',
    group: 'Go to',
    keywords: ['home', 'dashboard', 'overview', 'capture'],
  },
  {
    id: 'timeline',
    kind: 'quick_link',
    title: 'Timeline',
    snippet: 'Browse team events and filters.',
    href: '/app/timeline',
    group: 'Go to',
    keywords: ['timeline', 'events', 'history', 'activity'],
  },
  {
    id: 'ask',
    kind: 'quick_link',
    title: 'Ask',
    snippet: 'Ask the workspace agent.',
    href: '/app/chat',
    group: 'Go to',
    keywords: ['ask', 'chat', 'agent', 'question'],
  },
  {
    id: 'work',
    kind: 'quick_link',
    title: 'Work',
    snippet: 'Open work surfaces.',
    href: '/app/work',
    group: 'Go to',
    keywords: ['work', 'workspace', 'surfaces'],
  },
  {
    id: 'objects',
    kind: 'quick_link',
    title: 'Objects',
    snippet: 'Browse people, companies, projects, decisions, and other workspace objects.',
    href: '/app/objects',
    group: 'Work',
    keywords: ['objects', 'entities', 'people', 'companies', 'projects', 'decisions'],
  },
  {
    id: 'tasks',
    kind: 'quick_link',
    title: 'Tasks',
    snippet: 'Review active tasks and follow-ups.',
    href: '/app/tasks',
    group: 'Work',
    keywords: ['tasks', 'todo', 'follow up', 'follow-up', 'kanban'],
  },
  {
    id: 'boards',
    kind: 'quick_link',
    title: 'Boards',
    snippet: 'Open curated boards.',
    href: '/app/boards',
    group: 'Work',
    keywords: ['boards', 'board', 'pipeline', 'task board', 'catalog'],
  },
  {
    id: 'calendar',
    kind: 'quick_link',
    title: 'Calendar',
    snippet: 'Review meetings, deadlines, and scheduled work.',
    href: '/app/calendar',
    group: 'Work',
    keywords: ['calendar', 'schedule', 'meeting', 'deadline', 'events'],
  },
  {
    id: 'inbox',
    kind: 'quick_link',
    title: 'Inbox',
    snippet: 'Open notifications and unread items.',
    href: '/app/inbox',
    group: 'Work',
    keywords: ['inbox', 'notifications', 'unread'],
  },
  {
    id: 'approvals',
    kind: 'quick_link',
    title: 'Approvals',
    snippet: 'Review pending suggestions.',
    href: '/app/approvals',
    group: 'Work',
    keywords: ['approvals', 'suggestions', 'review', 'pending'],
  },
  {
    id: 'sources',
    kind: 'quick_link',
    title: 'Sources',
    snippet: 'Open source and capture setup.',
    href: '/app/sources',
    group: 'Go to',
    keywords: ['sources', 'capture', 'connectors', 'setup'],
  },
  {
    id: 'documents',
    kind: 'quick_link',
    title: 'Documents',
    snippet: 'Browse and search team documents.',
    href: '/app/documents',
    group: 'Sources',
    keywords: ['documents', 'docs', 'files', 'drive', 'upload'],
  },
  {
    id: 'meetings',
    kind: 'quick_link',
    title: 'Meetings',
    snippet: 'Invite notetakers and review meeting captures.',
    href: '/app/meetings',
    group: 'Sources',
    keywords: ['meetings', 'notetaker', 'recall', 'bot', 'transcript'],
  },
  {
    id: 'team',
    kind: 'quick_link',
    title: 'Team',
    snippet: 'Manage team settings and members.',
    href: '/app/team',
    group: 'Team',
    keywords: ['team', 'settings', 'members', 'invite'],
  },
  {
    id: 'invite-member',
    kind: 'quick_link',
    title: 'Invite a team member',
    snippet: 'Open team settings at the invite form.',
    href: '/app/team#invite',
    group: 'Team',
    keywords: ['invite', 'member', 'teammate', 'team member', 'add user'],
  },
  {
    id: 'integrations',
    kind: 'quick_link',
    title: 'Integrations',
    snippet: 'Connect and manage third-party integrations.',
    href: '/app/team/integrations',
    group: 'Sources',
    keywords: [
      'integrations',
      'connect',
      'github',
      'linear',
      'google drive',
      'monday',
      'slack',
      'sentry',
      'mcp',
    ],
  },
  {
    id: 'github-integration',
    kind: 'quick_link',
    title: 'GitHub integration',
    snippet: 'Connect GitHub repositories, PRs, issues, and releases.',
    href: '/app/team/integrations#github',
    group: 'Sources',
    keywords: ['github', 'git hub', 'repo', 'repositories', 'pull request', 'pr'],
  },
  {
    id: 'google-drive-integration',
    kind: 'quick_link',
    title: 'Google Drive integration',
    snippet: 'Connect Google Drive folders to documents.',
    href: '/app/team/integrations#google_drive',
    group: 'Sources',
    keywords: ['google drive', 'drive', 'docs', 'documents'],
  },
  {
    id: 'linear-integration',
    kind: 'quick_link',
    title: 'Linear integration',
    snippet: 'Connect Linear issues, comments, and projects.',
    href: '/app/team/integrations#linear',
    group: 'Sources',
    keywords: ['linear', 'issues', 'project management'],
  },
  {
    id: 'monday-integration',
    kind: 'quick_link',
    title: 'Monday.com integration',
    snippet: 'Connect Monday.com boards, items, updates, and status changes.',
    href: '/app/team/integrations#monday',
    group: 'Sources',
    keywords: ['monday', 'monday.com', 'boards', 'items', 'project management'],
  },
  {
    id: 'sentry-integration',
    kind: 'quick_link',
    title: 'Sentry integration',
    snippet: 'Connect Sentry projects, issues, regressions, and releases.',
    href: '/app/team/integrations#sentry',
    group: 'Sources',
    keywords: ['sentry', 'errors', 'issues', 'regressions', 'releases'],
  },
  {
    id: 'slack-setup',
    kind: 'quick_link',
    title: 'Slack setup',
    snippet: 'Configure Slack capture.',
    href: '/app/team/slack',
    group: 'Sources',
    keywords: ['slack', 'setup', 'channels', 'source'],
  },
  {
    id: 'telegram-setup',
    kind: 'quick_link',
    title: 'Telegram setup',
    snippet: 'Configure Telegram capture.',
    href: '/app/team/telegram',
    group: 'Sources',
    keywords: ['telegram', 'setup', 'groups', 'source'],
  },
  {
    id: 'team-audit',
    kind: 'quick_link',
    title: 'Team audit',
    snippet: 'Review team trust and audit events.',
    href: '/app/team/audit',
    group: 'Team',
    keywords: ['audit', 'trust', 'team audit', 'security'],
  },
  {
    id: 'job-recovery',
    kind: 'quick_link',
    title: 'Job recovery',
    snippet: 'Review failed background jobs.',
    href: '/app/team/jobs',
    group: 'Team',
    keywords: ['jobs', 'job recovery', 'failed jobs', 'background'],
    adminOnly: true,
  },
  {
    id: 'mcp-share',
    kind: 'quick_link',
    title: 'Timeline as MCP',
    snippet: 'Expose Timeline as a team MCP server.',
    href: '/app/team/mcp-share',
    group: 'Sources',
    keywords: ['mcp', 'server', 'share', 'bearer key'],
    adminOnly: true,
  },
  {
    id: 'help-docs',
    kind: 'external_link',
    title: 'Public help docs',
    snippet: 'Open public Timeline help in a new tab.',
    href: '/help',
    externalHref: '/help',
    group: 'Docs',
    keywords: ['help', 'docs', 'documentation', 'public docs', 'manual'],
  },
  {
    id: 'setup-docs',
    kind: 'external_link',
    title: 'Integration setup docs',
    snippet: 'Open integration setup documentation in a new tab.',
    href: '/docs/setup/integrations.html',
    externalHref: '/docs/setup/integrations.html',
    group: 'Docs',
    keywords: ['setup docs', 'integration docs', 'docs', 'mcp docs'],
  },
];

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/['"]/g, '')
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function scoreLexical(input: LexicalScoreInput): GlobalSearchScoreParts {
  const query = input.query.trim().toLowerCase();
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return {};

  const title = input.title.toLowerCase();
  const haystack = [input.title, ...(input.fields ?? []), ...(input.keywords ?? [])]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return {};

  const lexical = matched / tokens.length;
  let titleScore = 0;
  if (title === query) titleScore = 1;
  else if (title.startsWith(query)) titleScore = 0.84;
  else {
    const titleMatches = tokens.filter((token) => title.includes(token)).length;
    titleScore = titleMatches > 0 ? titleMatches / tokens.length : 0;
  }

  const ordered = haystack.includes(query) ? 0.2 : 0;
  return {
    lexical: Math.min(1, lexical + ordered),
    title: Math.min(1, titleScore),
  };
}

export function scoreIntent(
  query: string,
  kind: GlobalSearchKind,
  keywords: readonly string[] = [],
) {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return 0;
  const queryText = query.toLowerCase();
  const mentions = (value: string) => tokens.includes(value) || queryText.includes(value);
  const has = (values: readonly string[]) =>
    values.some(mentions) || keywords.some((keyword) => mentions(keyword.toLowerCase()));

  if (kind === 'quick_link' || kind === 'external_link') {
    if (has(['invite', 'integration', 'github', 'linear', 'drive', 'docs', 'help', 'team']))
      return 1;
    return tokens.length <= 2 ? 0.75 : 0.35;
  }
  if (kind === 'task' && has(['task', 'todo', 'follow', 'blocked'])) return 0.8;
  if (kind === 'board' && has(['board', 'pipeline', 'kanban'])) return 0.8;
  if (kind === 'calendar_event' && has(['calendar', 'meeting', 'schedule', 'deadline'])) return 0.8;
  if (kind === 'document_chunk' && has(['doc', 'docs', 'document', 'file', 'pdf'])) return 0.65;
  if (kind === 'timeline_event' && has(['timeline', 'event', 'history', 'said'])) return 0.65;
  return 0;
}

export function scoreRecency(date: Date | string | null | undefined, now = new Date()): number {
  if (!date) return 0;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return 0;
  const ageDays = Math.abs(now.getTime() - d.getTime()) / 86_400_000;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.55;
  if (ageDays <= 90) return 0.25;
  return 0;
}

export function scoreFromParts(parts: GlobalSearchScoreParts): number {
  return Number(
    (
      (parts.semantic ?? 0) * SEMANTIC_WEIGHT +
      (parts.lexical ?? 0) * LEXICAL_WEIGHT +
      (parts.title ?? 0) * TITLE_WEIGHT +
      (parts.intent ?? 0) * INTENT_WEIGHT +
      (parts.recency ?? 0) * RECENCY_WEIGHT +
      (parts.navigation ?? 0) * NAVIGATION_WEIGHT
    ).toFixed(6),
  );
}

export function finalizeGlobalSearchResult(
  result: Omit<GlobalSearchResult, 'score'> & { score?: number },
): GlobalSearchResult {
  return {
    ...result,
    score: result.score ?? scoreFromParts(result.scoreParts),
  };
}

export function rankGlobalSearchResults(
  results: readonly GlobalSearchResult[],
): GlobalSearchResult[] {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = Date.parse(a.updatedAt ?? a.occurredAt ?? a.startAt ?? '');
    const bTime = Date.parse(b.updatedAt ?? b.occurredAt ?? b.startAt ?? '');
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && bTime !== aTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });
}

export function searchQuickLinks(input: {
  query: string;
  kinds?: readonly GlobalSearchKind[];
  includeAdmin?: boolean;
  limit?: number;
}): GlobalSearchResult[] {
  const kinds = input.kinds ? new Set(input.kinds) : null;
  const matches: GlobalSearchResult[] = [];
  for (const link of QUICK_LINKS) {
    if (link.adminOnly && !input.includeAdmin) continue;
    if (kinds && !kinds.has(link.kind)) continue;
    const lexical = scoreLexical({
      query: input.query,
      title: link.title,
      fields: [link.snippet, link.group],
      keywords: link.keywords,
    });
    const hasQuery = input.query.trim().length > 0;
    const parts: GlobalSearchScoreParts = {
      ...lexical,
      intent: scoreIntent(input.query, link.kind, link.keywords),
      navigation: hasQuery ? (lexical.lexical || lexical.title ? 1 : 0.2) : 0.4,
    };
    const base = {
      id: link.id,
      kind: link.kind,
      title: link.title,
      snippet: link.snippet,
      href: link.href,
      scoreParts: parts,
      metadata: { group: link.group },
    };
    const result = finalizeGlobalSearchResult(
      link.externalHref ? { ...base, externalHref: link.externalHref } : base,
    );
    if (!hasQuery || result.score > 0.35) matches.push(result);
  }
  return rankGlobalSearchResults(matches).slice(0, input.limit ?? 12);
}
