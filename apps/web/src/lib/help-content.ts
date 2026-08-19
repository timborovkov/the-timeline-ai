import {
  Boxes,
  ClipboardList,
  FolderOpen,
  Inbox,
  KanbanSquare,
  LibraryBig,
  LifeBuoy,
  PlugZap,
} from 'lucide-react';

import type { LucideIcon } from 'lucide-react';

type HelpSlug = 'capture' | 'work' | 'documents' | 'boards' | 'integrations' | 'objects';

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
    description:
      'Send raw work into Timeline from web, Slack, Telegram, email, meetings, and uploads.',
    icon: Inbox,
    related: ['work', 'integrations'],
    sections: [
      {
        title: 'What gets captured',
        body: 'Timeline accepts unstructured notes first and turns them into events, objects, facts, tasks, and searchable citations after capture.',
        items: [
          'Text notes and audio uploads from the web app.',
          'Slack and Telegram messages, files, and voice memos from linked spaces.',
          'Forwarded, CCed, or BCCed email sent to your team address.',
          'Meeting transcripts from consent-gated bots that join calls.',
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
    slug: 'work',
    title: 'Work surface',
    description:
      'Use tasks, boards, objects, updates, digests, and handoffs that stay current from evidence.',
    icon: ClipboardList,
    related: ['capture', 'objects', 'boards'],
    sections: [
      {
        title: 'What Work is',
        body: 'Work is the operating surface Timeline keeps current from captured evidence. It brings tasks, boards, objects, comments, updates, digests, and handoffs together without asking teammates to maintain a separate tracker.',
        items: [
          'Overview leads with mixed pinned work, then team boards, then the work queue for due and assigned items.',
          'Pin objects, boards, documents, meetings, and calendar events to Home; Work → Pinned is the manager. Ask bindings say About {name}, not Pin.',
          'Queue rows keep the object type off the metadata chips; status, assignee, due date, and priority change inline.',
          'Home opens the team setup checklist under Ask for new teams; after Hide it stays as a quiet Team setup checklist toggle. Other app pages keep a quiet header chip back to that panel until setup is done or hidden.',
          'Home lists open tasks and one open-objects count (people, companies, projects, deals, and follow-ups) when those counts are not zero.',
          'Tasks and boards show owners, status, blockers, due dates, and source evidence.',
          'Object pages keep people, companies, projects, deals, documents, and tasks tied to the event history.',
          'Updates, digests, and handoffs are generated from the current work state with citations.',
          'On dashboard pages other than Home, floating Ask (⌘J / Ctrl+J) asks about the current view and keeps one thread until New. Home still opens the full Ask page.',
          'Work → Digests lists every stored daily briefing as collapsed rows so a teammate can open a specific day.',
        ],
        appLink: { href: '/app/work', label: 'Open Work' },
      },
      {
        title: 'How it stays current',
        body: 'Timeline extracts proposed state from conversations, email, meetings, documents, and integrations, then keeps receipts attached so changes can be reviewed.',
        items: [
          'Raw events stay intact; summaries can change without rewriting source evidence.',
          'Important state can go through human review before it becomes canonical.',
          'Use manual edits for judgment, not for retyping what already happened.',
        ],
      },
    ],
  },
  {
    slug: 'documents',
    title: 'Document drive',
    description: 'Upload, version, search, and cite team documents alongside the event timeline.',
    icon: FolderOpen,
    related: ['capture', 'work'],
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
    description: 'Use kanban and list views over tasks and workspace objects.',
    icon: KanbanSquare,
    related: ['work', 'objects'],
    sections: [
      {
        title: 'What boards show',
        body: 'Boards are part of Work. They do not create a second task system; they organize the same people, companies, deals, projects, and tasks that appear in objects, search, and answers.',
        items: [
          'Kanban boards group explicit board items by board-owned lanes.',
          'List views help scan responsible people, due dates, priority, and next steps in compact rows.',
          'Templates help create pipelines, task boards, catalogs, and custom boards.',
        ],
        appLink: { href: '/app/boards', label: 'Open boards' },
      },
      {
        title: 'Keeping boards useful',
        body: 'Boards work best when board item properties and object state stay current. Timeline can suggest changes from raw events, but a user still chooses what becomes canonical.',
        items: [
          'Drag board items between lanes when workflow state changes.',
          'Open card details for board notes, next steps, evidence, and object links.',
          'Pin a board to Home when you return to it often.',
        ],
      },
    ],
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    description: 'Connect durable sources and live MCP tools without breaking team isolation.',
    icon: PlugZap,
    related: ['capture', 'work'],
    sections: [
      {
        title: 'Connected sources',
        body: 'First-party integrations and ingest paths can create durable evidence. MCP servers give the agent live reach into approved tools; successful tool results are captured privately, but MCP is not passive provider sync.',
        items: [
          'Google Drive syncs selected folders and files into the document drive.',
          'GitHub and Linear bring engineering and project activity into the operational record.',
          'Monday.com syncs selected boards, generic records, subitems, updates, columns, and WorkDocs.',
          'Slack workspace ingestion syncs selected channels, threads, files, reactions, and edits.',
          'Sentry syncs issue updates, resolved issues, and releases into cited events, evidence clusters, and customer/project associations.',
          'Slack, Telegram, email, and meeting bots are capture surfaces for conversations and calls.',
          'Custom MCP servers expose approved live tools and context to the agent; successful tool results are captured as private evidence for later reconciliation while passive provider activity still needs native sync or custom ingestion.',
        ],
        appLink: { href: '/app/sources', label: 'Open connections' },
      },
      {
        title: 'Security model',
        body: 'OAuth tokens and bearer secrets are encrypted at rest. Imported snippets are treated as external content before the agent sees them.',
        items: [
          'Admins control team-level source activation.',
          'Connection owners control what provider resources are shared.',
          'For Monday.com, selecting a parent board also captures its classic subitems; hidden “Subitems of …” helper boards are not selected separately.',
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
    related: ['work', 'boards'],
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
          'Use object discussion comments for human judgment, @mentions, and extra context.',
          'Resolve duplicate meanings before creating a new object.',
          'Keep responsible people, priority, due dates, and next steps current for boards.',
        ],
      },
    ],
  },
];

export const HELP_NAV = [
  { href: '/help', label: 'Overview', icon: LibraryBig },
  ...HELP_PAGES.map((page) => ({
    href: `/help/${page.slug}`,
    label: page.title,
    icon: page.icon,
  })),
  { href: '/help/support', label: 'Support', icon: LifeBuoy },
];

export function findHelpPage(slug: string): HelpPage | undefined {
  return HELP_PAGES.find((page) => page.slug === slug);
}
