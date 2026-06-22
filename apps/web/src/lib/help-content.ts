import {
  Boxes,
  ClipboardList,
  FolderOpen,
  GitBranch,
  Inbox,
  KanbanSquare,
  LifeBuoy,
  PlugZap,
  Search,
  Settings2,
  Upload,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

type HelpSlug = 'capture' | 'documents' | 'boards' | 'integrations' | 'objects';

interface HelpLink {
  href: string;
  label: string;
  signedOutLabel?: string;
}

interface HelpSection {
  title: string;
  body: string;
  items?: string[];
  appLink?: HelpLink;
}

interface HelpPage {
  slug: HelpSlug;
  title: string;
  description: string;
  icon: LucideIcon;
  sections: HelpSection[];
  related: HelpSlug[];
}

export const HELP_PAGES: HelpPage[] = [
  {
    slug: 'capture',
    title: 'Capture surfaces',
    description: 'Send raw work into Timeline from web, Telegram, email, meetings, and uploads.',
    icon: Inbox,
    related: ['documents', 'integrations'],
    sections: [
      {
        title: 'What gets captured',
        body: 'Timeline accepts unstructured notes first and turns them into events, objects, facts, tasks, and searchable citations after capture.',
        items: [
          'Text notes and audio uploads from the web app.',
          'Telegram messages and voice memos from linked DMs or team groups.',
          'Forwarded, CCed, or BCCed email sent to your team address.',
          'Meeting transcripts from consent-gated meeting bots.',
          'Document uploads that become searchable chunks after extraction.',
        ],
        appLink: { href: '/app/timeline', label: 'Open timeline capture' },
      },
      {
        title: 'Good capture habits',
        body: 'Use the surface that is closest to the work. A rough voice memo beats a polished recap that never gets written.',
        items: [
          'Name the people, companies, projects, or deals involved.',
          'Add the next step if there is one.',
          'Keep private notes private at capture time when they are not for the whole team.',
        ],
      },
    ],
  },
  {
    slug: 'documents',
    title: 'Document drive',
    description: 'Upload, version, search, and cite team documents alongside the event timeline.',
    icon: FolderOpen,
    related: ['capture', 'objects'],
    sections: [
      {
        title: 'How the drive works',
        body: 'The document drive stores originals and versions while extracted text feeds the same search and agent citation system as events.',
        items: [
          'Folders keep documents browsable without hiding them from search.',
          'Every upload creates a version, so old files stay inspectable.',
          'Agent answers cite document chunks back to the source version.',
        ],
        appLink: { href: '/app/documents', label: 'Open document drive' },
      },
      {
        title: 'Visibility',
        body: 'Document visibility follows the same team, private, or specific-user model as timeline events.',
        items: [
          'Team documents are visible to all members.',
          'Private documents stay visible only to the uploader.',
          'Restricted documents are visible only to selected users.',
        ],
      },
    ],
  },
  {
    slug: 'boards',
    title: 'Boards',
    description: 'Use curated kanban, table, and list work surfaces over Timeline objects.',
    icon: KanbanSquare,
    related: ['objects', 'capture'],
    sections: [
      {
        title: 'What boards show',
        body: 'Boards are curated work surfaces over workspace objects. They do not create a second task system; they organize the same people, companies, deals, projects, and tasks that appear in search and chat.',
        items: [
          'Kanban boards group explicit board items by board-owned lanes.',
          'Table views help scan responsible people, due dates, priority, and recent activity.',
          'Templates help create pipelines, task boards, catalogs, and custom boards.',
        ],
        appLink: { href: '/app/boards', label: 'Open boards' },
      },
      {
        title: 'Keeping boards useful',
        body: 'Boards work best when board item properties and object memory stay current. Timeline can suggest changes from raw events, but a user still chooses what becomes canonical.',
        items: [
          'Drag board items between lanes when workflow state changes.',
          'Open card details for board notes, next steps, evidence, and object links.',
          'Use pinned boards for repeated team workflows.',
        ],
      },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    description:
      'Connect native sources, Slack workspace history, and MCP tools without breaking team isolation.',
    icon: PlugZap,
    related: ['capture', 'documents'],
    sections: [
      {
        title: 'Connected sources',
        body: 'Integrations import external activity into the same event pipeline as manual capture. Members own provider connections; admins activate the shared sources that feed team memory.',
        items: [
          'Google Drive syncs selected folders and files into the document drive.',
          'GitHub and Linear bring engineering and project activity into team memory.',
          'Monday.com syncs boards, generic records, subitems, updates, columns, and WorkDocs.',
          'Slack workspace ingestion syncs selected channels, threads, files, reactions, and edits.',
          'Sentry syncs issue updates, resolved issues, and releases into cited events and incident objects.',
          'MCP servers expose approved live tools; they do not create durable timeline events unless paired with native sync or custom ingestion.',
        ],
        appLink: { href: '/app/team/integrations', label: 'Open integrations' },
      },
      {
        title: 'Security model',
        body: 'OAuth tokens and bearer secrets are encrypted at rest. Imported snippets are treated as external content before the agent sees them.',
        items: [
          'Admins control team-level source activation.',
          'Connection owners control what provider resources are shared.',
          'Personal MCP connections are visible only to their owner.',
          'Outbound Timeline MCP keys see only team-visible events.',
        ],
      },
    ],
  },
  {
    slug: 'objects',
    title: 'Object management',
    description:
      'Track the people, companies, projects, deals, and tasks extracted from team activity.',
    icon: Boxes,
    related: ['boards', 'documents'],
    sections: [
      {
        title: 'What objects are',
        body: 'Objects are the durable records Timeline resolves from raw activity. They collect facts, notes, relationships, open tasks, and recent changes in one place.',
        items: [
          'People, companies, projects, deals, and tasks share one object system.',
          'Object pages show cited timeline activity and extracted facts.',
          'Manual edits write an activity trail instead of overwriting history silently.',
        ],
        appLink: { href: '/app/objects', label: 'Open objects' },
      },
      {
        title: 'Ownership and edits',
        body: 'The visibility owner controls whether an event changes from private or restricted to broader visibility. Team admins do not bypass private context.',
        items: [
          'Use object notes for human judgment and extra context.',
          'Resolve duplicate meanings before creating a new object.',
          'Keep responsible people, priority, due dates, and next steps current for boards.',
        ],
      },
    ],
  },
];

export const HELP_NAV = [
  { href: '/help', label: 'Overview', icon: Search },
  ...HELP_PAGES.map((page) => ({
    href: `/help/${page.slug}`,
    label: page.title,
    icon: page.icon,
  })),
  { href: '/help/support', label: 'Support', icon: LifeBuoy },
];

export const HELP_INDEX_GROUPS = [
  {
    title: 'Start here',
    items: [
      { href: '/help/capture', label: 'Capture surfaces', icon: Upload },
      { href: '/help/documents', label: 'Document drive', icon: FolderOpen },
      { href: '/help/objects', label: 'Object management', icon: Boxes },
    ],
  },
  {
    title: 'Workflows',
    items: [
      { href: '/help/boards', label: 'Boards', icon: ClipboardList },
      { href: '/help/integrations', label: 'Integrations', icon: GitBranch },
      { href: '/help/support', label: 'Contact support', icon: Settings2 },
    ],
  },
];

export function findHelpPage(slug: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.slug === slug);
}
