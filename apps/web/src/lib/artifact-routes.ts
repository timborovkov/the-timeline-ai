export interface ArtifactRoutePreview {
  id: string;
  title: string;
  description: string;
  href: string;
  group: 'dashboard' | 'help';
}

const ARTIFACT_ROUTE_PREVIEWS: readonly ArtifactRoutePreview[] = [
  {
    id: 'home',
    title: 'Home',
    description: 'Dashboard overview, capture entry points, and current team activity.',
    href: '/app',
    group: 'dashboard',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description: 'Raw captured events, source evidence, filters, and capture history.',
    href: '/app/timeline',
    group: 'dashboard',
  },
  {
    id: 'chat',
    title: 'Ask',
    description: 'Full-screen agent chat for asking questions about team memory.',
    href: '/app/chat',
    group: 'dashboard',
  },
  {
    id: 'objects',
    title: 'Objects',
    description: 'People, companies, projects, deals, topics, tasks, and other workspace objects.',
    href: '/app/objects',
    group: 'dashboard',
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Task and follow-up objects gathered from team activity.',
    href: '/app/tasks',
    group: 'dashboard',
  },
  {
    id: 'boards',
    title: 'Boards',
    description: 'Curated kanban, table, and list surfaces over workspace objects.',
    href: '/app/boards',
    group: 'dashboard',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description:
      'Team calendar events, recurring meetings, tentative slots, and scheduling context.',
    href: '/app/calendar',
    group: 'dashboard',
  },
  {
    id: 'documents',
    title: 'Documents',
    description:
      'Document drive, captured files, extracted text, versions, and document citations.',
    href: '/app/documents',
    group: 'dashboard',
  },
  {
    id: 'meetings',
    title: 'Meetings',
    description: 'Saved meetings, transcripts, meeting bots, and capture status.',
    href: '/app/meetings',
    group: 'dashboard',
  },
  {
    id: 'team',
    title: 'Team',
    description: 'Team settings, members, invites, integrations, audit, and operational controls.',
    href: '/app/team',
    group: 'dashboard',
  },
  {
    id: 'team/invites',
    title: 'Invite Team Members',
    description: 'Invite teammates and manage active team membership from Team settings.',
    href: '/app/team',
    group: 'dashboard',
  },
  {
    id: 'help/capture',
    title: 'Capture Surfaces Guide',
    description:
      'How to send raw work into Timeline from web, Telegram, email, meetings, and uploads.',
    href: '/help/capture',
    group: 'help',
  },
  {
    id: 'help/documents',
    title: 'Document Drive Guide',
    description: 'How documents, versions, extracted text, and citations work.',
    href: '/help/documents',
    group: 'help',
  },
  {
    id: 'help/boards',
    title: 'Boards Guide',
    description: 'How curated boards organize workspace objects and team workflows.',
    href: '/help/boards',
    group: 'help',
  },
  {
    id: 'help/objects',
    title: 'Object Management Guide',
    description: 'How Timeline tracks people, companies, projects, deals, and tasks.',
    href: '/help/objects',
    group: 'help',
  },
  {
    id: 'help/integrations',
    title: 'Integrations Guide',
    description: 'How connected sources and MCP tools feed team memory.',
    href: '/help/integrations',
    group: 'help',
  },
];

export function getArtifactRoutePreview(id: string): ArtifactRoutePreview | null {
  return ARTIFACT_ROUTE_PREVIEWS.find((route) => route.id === id) ?? null;
}
