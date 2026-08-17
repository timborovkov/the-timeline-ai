import { artifactRefCitation } from '#src/citation.js';

export type AppGuideGroup = 'dashboard' | 'help';
export type AppGuideRole = 'member' | 'admin';

export interface AppGuideRoute {
  id: string;
  title: string;
  description: string;
  href: string;
  group: AppGuideGroup;
  minRole: AppGuideRole;
  intents: string[];
  guide: string;
  relatedRouteIds?: string[];
}

export interface AppGuideSearchResult extends AppGuideRoute {
  score: number;
  citation: string;
}

export const APP_GUIDE_ROUTES: readonly AppGuideRoute[] = [
  {
    id: 'home',
    title: 'Home',
    description: 'Ask, capture, pinned work, attention, and current team activity.',
    href: '/app',
    group: 'dashboard',
    minRole: 'member',
    intents: [
      'dashboard overview',
      'home',
      'what is happening',
      'capture quick note',
      'pinned work',
    ],
    guide:
      'Use Home to ask the timeline, capture a quick note, revisit pinned boards or objects, and review current team activity.',
    relatedRouteIds: ['timeline', 'chat'],
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description: 'Raw captured events, source evidence, filters, and capture history.',
    href: '/app/timeline',
    group: 'dashboard',
    minRole: 'member',
    intents: ['timeline', 'captured events', 'raw events', 'evidence', 'capture history'],
    guide:
      'Use Timeline to inspect raw captured events, filter by source/date, and open source evidence behind agent answers.',
    relatedRouteIds: ['home', 'help/capture'],
  },
  {
    id: 'chat',
    title: 'Ask',
    description: 'Full-screen agent chat for asking questions about the operational record.',
    href: '/app/chat',
    group: 'dashboard',
    minRole: 'member',
    intents: ['ask', 'agent chat', 'question', 'operational record', 'timeline answer'],
    guide:
      'Use Ask for the full-screen agent chat. It is the power surface for longer questions, citations, tool steps, and persisted private chat sessions.',
    relatedRouteIds: ['home', 'timeline'],
  },
  {
    id: 'objects',
    title: 'Objects',
    description: 'People, companies, projects, deals, topics, tasks, and other workspace objects.',
    href: '/app/objects',
    group: 'dashboard',
    minRole: 'member',
    intents: ['objects', 'people', 'companies', 'projects', 'deals', 'topics', 'object cleanup'],
    guide:
      'Use Objects to browse durable records resolved from team activity. Object pages collect facts, notes, relationships, tasks, and recent changes.',
    relatedRouteIds: ['work', 'tasks', 'boards', 'help/objects'],
  },
  {
    id: 'objects/new',
    title: 'New Object',
    description: 'Create a person, company, project, deal, task, topic, or other workspace object.',
    href: '/app/objects/new',
    group: 'dashboard',
    minRole: 'member',
    intents: ['create object', 'new object', 'add person', 'add company', 'add project'],
    guide:
      'Use New Object when the user wants to create a durable workspace record manually instead of waiting for extraction or suggestions.',
    relatedRouteIds: ['objects', 'help/objects'],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Task and follow-up objects gathered from team activity.',
    href: '/app/tasks',
    group: 'dashboard',
    minRole: 'member',
    intents: ['tasks', 'follow ups', 'todos', 'next actions', 'blocked work', 'due dates'],
    guide:
      'Use Tasks for task and follow-up objects. Tasks are still workspace objects, so object details and citations stay connected.',
    relatedRouteIds: ['work', 'objects', 'calendar', 'boards'],
  },
  {
    id: 'work',
    title: 'Work',
    description:
      'Daily operating surface for tasks, boards, objects, updates, digests, handoffs, and evidence.',
    href: '/app/work',
    group: 'dashboard',
    minRole: 'member',
    intents: [
      'work',
      'work surface',
      'operating surface',
      'updates',
      'digests',
      'handoffs',
      'tasks and boards',
    ],
    guide:
      'Use Work as the daily operating surface. It keeps tasks, boards, objects, updates, digests, and handoffs current from captured evidence without requiring a separate tracker.',
    relatedRouteIds: ['tasks', 'boards', 'objects', 'timeline', 'help/work'],
  },
  {
    id: 'boards',
    title: 'Boards',
    description: 'Curated kanban, table, and list surfaces over workspace objects.',
    href: '/app/boards',
    group: 'dashboard',
    minRole: 'member',
    intents: ['boards', 'kanban', 'pipeline', 'lanes', 'table view', 'workflow board'],
    guide:
      'Use Boards for curated kanban, table, and list workflows over the same workspace objects shown elsewhere.',
    relatedRouteIds: ['work', 'objects', 'tasks', 'help/boards'],
  },
  {
    id: 'boards/new',
    title: 'New Board',
    description: 'Create a custom board or start from a board template.',
    href: '/app/boards/new',
    group: 'dashboard',
    minRole: 'member',
    intents: ['create board', 'new board', 'board template', 'pipeline template'],
    guide:
      'Use New Board when the team needs a new workflow surface, such as a pipeline, task board, catalog, or custom tracker.',
    relatedRouteIds: ['boards', 'help/boards'],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description:
      'Team calendar events, recurring meetings, tentative slots, and scheduling context.',
    href: '/app/calendar',
    group: 'dashboard',
    minRole: 'member',
    intents: ['calendar', 'meetings', 'schedule', 'recurring events', 'tentative slots'],
    guide:
      'Use Calendar to inspect scheduled events, recurring meetings, tentative proposals, reminders, and scheduling context.',
    relatedRouteIds: ['tasks', 'meetings'],
  },
  {
    id: 'documents',
    title: 'Documents',
    description:
      'Document drive, captured files, extracted text, versions, and document citations.',
    href: '/app/documents',
    group: 'dashboard',
    minRole: 'member',
    intents: ['documents', 'drive', 'files', 'uploads', 'versions', 'document citations'],
    guide:
      'Use Documents to upload, version, organize, search, and inspect files whose extracted text can be cited by the agent.',
    relatedRouteIds: ['help/documents', 'timeline'],
  },
  {
    id: 'meetings',
    title: 'Meetings',
    description: 'Saved meetings, transcripts, meeting bots, and capture status.',
    href: '/app/meetings',
    group: 'dashboard',
    minRole: 'member',
    intents: ['meetings', 'transcripts', 'meeting bot', 'call recap', 'recorded meetings'],
    guide:
      'Use Meetings to view saved meeting transcripts, meeting-bot capture status, and meeting-derived evidence.',
    relatedRouteIds: ['calendar', 'help/capture'],
  },
  {
    id: 'team',
    title: 'Team',
    description: 'Team settings, members, invites, integrations, audit, and operational controls.',
    href: '/app/team',
    group: 'dashboard',
    minRole: 'member',
    intents: ['team settings', 'members', 'team admin', 'workspace settings'],
    guide:
      'Use Team for workspace membership, settings, sources, integrations, audit views, and operational controls. Some actions require admin permissions.',
    relatedRouteIds: ['team/invites', 'team/integrations'],
  },
  {
    id: 'team/invites',
    title: 'Invite Team Members',
    description: 'Invite teammates and manage active team membership from Team settings.',
    href: '/app/team',
    group: 'dashboard',
    minRole: 'admin',
    intents: ['invite team members', 'add teammate', 'invite user', 'manage members'],
    guide:
      'Use the Team page to invite teammates and manage membership. Inviting members requires an admin-level team role.',
    relatedRouteIds: ['team'],
  },
  {
    id: 'team/integrations',
    title: 'Integrations',
    description:
      'Connect Drive, Linear, GitHub, Monday.com, Slack workspace, Sentry, custom ingest webhooks, and MCP tools.',
    href: '/app/team/integrations',
    group: 'dashboard',
    minRole: 'admin',
    intents: [
      'integrations',
      'connect source',
      'google drive',
      'linear',
      'github',
      'monday',
      'monday.com',
      'monday boards',
      'monday subitems',
      'workdocs',
      'work docs',
      'mcp',
      'slack',
      'sentry',
      'telegram',
      'figma',
      'stripe',
      'custom webhooks',
      'ingest webhooks',
    ],
    guide:
      'Use Team Integrations to connect native sources, activate shared provider resources, manage ingest webhooks, and add MCP tools. Monday.com board selection captures items, updates, columns, and subitems from the parent board; choose WorkDocs separately when docs should become cited evidence. Provider connections are person-owned, admins activate shared team sources, and MCP provides live tool/context access with private evidence capture for successful tool calls.',
    relatedRouteIds: ['help/integrations', 'team', 'connections', 'me/connections'],
  },
  {
    id: 'connections',
    title: 'Connections',
    description: 'Personal provider accounts, Slack, Telegram, team integrations, and MCP tools.',
    href: '/app/sources',
    group: 'dashboard',
    minRole: 'member',
    intents: [
      'connections',
      'connect slack',
      'connect telegram',
      'provider accounts',
      'where do I connect',
      'set up a source',
    ],
    guide:
      'Use Connections to see capture sources and linked accounts. Person-owned provider logins live under Provider accounts. Admins activate shared team sources on Team Integrations. Slack and Telegram have their own setup pages. MCP servers give the agent live tools without turning every call into timeline evidence.',
    relatedRouteIds: [
      'me/connections',
      'team/integrations',
      'team/slack',
      'team/telegram',
      'help/integrations',
      'help/capture',
    ],
  },
  {
    id: 'me/connections',
    title: 'Provider Accounts',
    description: 'Connect your Google, GitHub, Linear, Monday.com, or other provider login.',
    href: '/app/me/connections',
    group: 'dashboard',
    minRole: 'member',
    intents: [
      'connect my account',
      'oauth',
      'provider login',
      'google account',
      'github account',
      'linear account',
    ],
    guide:
      'Use Provider accounts to connect a personal login for Drive, GitHub, Linear, Monday.com, or Sentry. Connecting an account does not share it with the team until an admin activates a resource on Team Integrations.',
    relatedRouteIds: ['connections', 'team/integrations', 'help/integrations'],
  },
  {
    id: 'team/slack',
    title: 'Slack Setup',
    description: 'Install Slack, link your user, and capture channels or DMs.',
    href: '/app/team/slack',
    group: 'dashboard',
    minRole: 'member',
    intents: ['connect slack', 'slack bot', 'slack capture', 'install slack'],
    guide:
      'Use Slack setup to install the workspace app, link your Slack user, and choose what Timeline captures. Direct messages with Timeline are agent chat; channels stay capture unless someone invokes the agent.',
    relatedRouteIds: ['connections', 'help/capture', 'chat'],
  },
  {
    id: 'team/telegram',
    title: 'Telegram Setup',
    description: 'Connect Telegram capture and direct-chat routing for this team.',
    href: '/app/team/telegram',
    group: 'dashboard',
    minRole: 'member',
    intents: ['connect telegram', 'telegram bot', 'telegram capture'],
    guide:
      'Use Telegram setup to connect the bot and route your Telegram account to this team. Direct chats with the bot are agent conversations; groups remain capture unless someone uses /ask.',
    relatedRouteIds: ['connections', 'help/capture', 'chat'],
  },
  {
    id: 'me/mcp-servers',
    title: 'Personal MCP Servers',
    description: 'Connect a personal MCP server so the agent can use its tools.',
    href: '/app/me/mcp-servers',
    group: 'dashboard',
    minRole: 'member',
    intents: ['personal mcp', 'add mcp server', 'connect mcp'],
    guide:
      'Use Personal MCP to connect a server you own. The agent can call its tools during Ask. Successful tool calls may capture a private evidence row; the live tool output is not treated as verified timeline data.',
    relatedRouteIds: ['team/mcp-servers', 'help/integrations', 'chat'],
  },
  {
    id: 'team/mcp-servers',
    title: 'Team MCP Servers',
    description: 'Admin-managed MCP servers shared with the team agent.',
    href: '/app/team/mcp-servers',
    group: 'dashboard',
    minRole: 'admin',
    intents: ['team mcp', 'shared mcp', 'workspace mcp'],
    guide:
      'Use Team MCP servers to add MCP tools the whole team can invoke from Ask. Admins control the server list and shared credentials.',
    relatedRouteIds: ['me/mcp-servers', 'help/integrations', 'chat'],
  },
  {
    id: 'team/integrations/monday',
    title: 'Monday.com Integration',
    description: 'Connect Monday.com boards, subitems, updates, columns, records, and WorkDocs.',
    href: '/app/team/integrations#monday',
    group: 'dashboard',
    minRole: 'admin',
    intents: [
      'monday',
      'monday.com',
      'monday boards',
      'monday subitems',
      'monday workdocs',
      'choose monday boards',
      'connect monday',
      'subitems',
      'workdocs',
      'pulses',
      'records',
    ],
    guide:
      'Use the Monday.com integration section to connect a Monday account and choose which boards and WorkDocs this Timeline team can use. Selecting a parent board captures its items, updates, columns, and classic subitems; hidden Subitems of helper boards are not selected separately.',
    relatedRouteIds: ['team/integrations', 'help/integrations'],
  },
  {
    id: 'team/approvals',
    title: 'Approvals',
    description: 'Review pending background proposals and approval-backed agent suggestions.',
    href: '/app/approvals',
    group: 'dashboard',
    minRole: 'member',
    intents: ['approvals', 'pending suggestions', 'review proposal', 'background suggestions'],
    guide:
      'Use Approvals to review proposal-queue items created by background agents or legacy approval-backed chat tools.',
    relatedRouteIds: ['objects', 'calendar'],
  },
  {
    id: 'help/capture',
    title: 'Capture Surfaces Guide',
    description:
      'How to send raw work into Timeline from web, Slack, Telegram, email, meetings, and uploads.',
    href: '/help/capture',
    group: 'help',
    minRole: 'member',
    intents: [
      'how to capture',
      'slack capture',
      'telegram capture',
      'email capture',
      'email cc',
      'audio upload',
      'meeting capture',
    ],
    guide:
      'Capture raw work wherever it happens: web notes, audio uploads, Slack, Telegram, CCed email, meeting transcripts, and document uploads all become timeline events.',
    relatedRouteIds: ['timeline', 'work', 'documents', 'meetings'],
  },
  {
    id: 'help/work',
    title: 'Work Surface Guide',
    description:
      'How tasks, boards, objects, updates, digests, and handoffs stay current from evidence.',
    href: '/help/work',
    group: 'help',
    minRole: 'member',
    intents: [
      'work surface',
      'work guide',
      'updates',
      'digests',
      'handoffs',
      'tasks and boards',
      'operational record',
    ],
    guide:
      'Work explains how Timeline turns captured evidence into current tasks, boards, objects, updates, digests, and handoffs while keeping source receipts attached.',
    relatedRouteIds: ['work', 'tasks', 'boards', 'objects'],
  },
  {
    id: 'help/documents',
    title: 'Document Drive Guide',
    description: 'How documents, versions, extracted text, and citations work.',
    href: '/help/documents',
    group: 'help',
    minRole: 'member',
    intents: ['how documents work', 'document citations', 'versioning', 'document visibility'],
    guide:
      'Documents store originals and versions while extracted text feeds search and citation. Visibility follows the same team/private/restricted model as timeline events.',
    relatedRouteIds: ['documents'],
  },
  {
    id: 'help/boards',
    title: 'Boards Guide',
    description: 'How curated boards organize workspace objects and team workflows.',
    href: '/help/boards',
    group: 'help',
    minRole: 'member',
    intents: ['how boards work', 'kanban guide', 'board templates', 'workflow guide'],
    guide:
      'Boards organize workspace objects into kanban, table, and list workflows. They do not create a second task system.',
    relatedRouteIds: ['boards', 'objects'],
  },
  {
    id: 'help/objects',
    title: 'Object Management Guide',
    description: 'How Timeline tracks people, companies, projects, deals, and tasks.',
    href: '/help/objects',
    group: 'help',
    minRole: 'member',
    intents: ['how objects work', 'object notes', 'relationships', 'duplicates', 'cleanup'],
    guide:
      'Objects are durable records resolved from activity. Use notes, relationships, cleanup suggestions, and object pages to keep the operational record accurate.',
    relatedRouteIds: ['work', 'objects', 'tasks'],
  },
  {
    id: 'help/integrations',
    title: 'Integrations Guide',
    description: 'How connected sources, capture surfaces, and MCP live tools fit together.',
    href: '/help/integrations',
    group: 'help',
    minRole: 'member',
    intents: ['how integrations work', 'mcp tools', 'connected sources', 'oauth security'],
    guide:
      'First-party integrations and ingest paths can create durable evidence. MCP servers give the agent approved live tool/context access. Tokens are encrypted, source snippets are treated as external content, and admins control shared sources.',
    relatedRouteIds: ['team/integrations', 'help/capture'],
  },
  {
    id: 'help/support',
    title: 'Support',
    description: 'Contact support or the product team.',
    href: '/help/support',
    group: 'help',
    minRole: 'member',
    intents: ['support', 'contact', 'product team', 'help'],
    guide: 'Use Support to contact the Timeline team for product help or support requests.',
  },
];

export function getAppGuideRoute(id: string): AppGuideRoute | null {
  return APP_GUIDE_ROUTES.find((route) => route.id === id) ?? null;
}

export function searchAppGuide(query: string, limit = 5): AppGuideSearchResult[] {
  const terms = tokenize(query);
  const cappedLimit = Math.max(1, Math.min(limit, 20));
  if (terms.length === 0) return [];
  return APP_GUIDE_ROUTES.map((route) => ({
    ...route,
    citation: artifactRefCitation({ kind: 'route', id: route.id }),
    score: scoreRoute(route, terms),
  }))
    .filter((route) => route.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, cappedLimit);
}

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  );
}

function scoreRoute(route: AppGuideRoute, terms: string[]): number {
  const fields = [
    { text: route.id, weight: 10 },
    { text: route.title, weight: 8 },
    { text: route.description, weight: 5 },
    { text: route.intents.join(' '), weight: 6 },
    { text: route.guide, weight: 3 },
    { text: route.href, weight: 2 },
  ];
  let score = 0;
  for (const term of terms) {
    for (const field of fields) {
      const value = field.text.toLowerCase();
      if (value === term) score += field.weight * 2;
      else if (value.includes(term)) score += field.weight;
    }
  }
  return score;
}
