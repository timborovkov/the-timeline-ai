import {
  Bot,
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

type HelpSlug =
  'capture' | 'work' | 'documents' | 'boards' | 'integrations' | 'agents' | 'objects' | 'billing';

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
  resourceLinks?: HelpLink[];
}

interface HelpPage {
  slug: HelpSlug;
  title: string;
  description: string;
  icon: LucideIcon;
  sections: HelpSection[];
  related: HelpSlug[];
  updatedAt?: `${number}-${number}-${number}`;
}

export const HELP_PAGES: HelpPage[] = [
  {
    slug: 'billing',
    title: 'Billing and spending limits',
    description: 'Understand Free, pay as you go, usage limits and payment settings.',
    icon: LifeBuoy,
    related: ['capture', 'integrations'],
    updatedAt: '2026-11-03',
    sections: [
      {
        title: 'Enable pay as you go',
        body: 'A team owner or admin manages billing for the current workspace. Pay as you go has no platform fee and keeps the included Free allowances; usage above them and additional members can create charges.',
        items: [
          'Open Team settings → Billing and check the workspace name.',
          'Choose Change plan → Pay as you go. Review the rates, included members and spending limit before continuing to payment.',
          'After checkout, wait for Billing to confirm activation. Returning from checkout alone does not mean the plan is active.',
          'Review Usage to see recorded charges. Three active members are included; additional members cost €2 per member per month.',
        ],
        appLink: { href: '/app/team?section=billing', label: 'Open Billing' },
      },
      {
        title: 'Understand the spending limit',
        body: 'The default PAYG spending limit is €25 per month. Owners and admins can change it in Billing. The cap applies to metered spend; platform fees and tax are outside it. On commitment plans, the cap is checked before included usage credit.',
        items: [
          'Free has both usage allowances and capacity limits; reaching either can pause a task.',
          'Work in progress can reserve allowance temporarily. If Ask cannot start, let other jobs finish and check Usage.',
          'Meeting minutes include joining and waiting-room time. Capturing sources can also trigger separately metered AI extraction and indexing.',
        ],
        appLink: { href: '/app/usage', label: 'Review Usage' },
      },
      {
        title: 'Invoices, payment changes and cancellation',
        body: 'Open Manage payment in Billing to use the payment provider’s customer portal. Review its confirmation for the effective cancellation date and any outstanding charges. Disconnecting a source or deleting individual data is not a billing cancellation. Disabling a team or requesting permanent team deletion stops new usage accrual and requests cancellation of renewal; restoration does not silently resume renewal. Fees and consumed usage are generally non-refundable, except where law requires otherwise or a refund is agreed. Report suspected billing errors with the workspace and invoice reference; mandatory consumer rights remain unaffected.',
        items: [
          'Check the active workspace before opening its payment portal.',
          'Use the portal to review invoices, payment details and available subscription actions.',
          'Return to Billing and verify the updated subscription state. If the portal does not offer the action you need or the state does not update, contact support.',
        ],
        appLink: { href: '/help/support', label: 'Contact billing support' },
      },
    ],
  },

  {
    slug: 'capture',
    title: 'Capture surfaces',
    description:
      'Send raw work into Timeline from web, Slack, Telegram, email, meetings, and uploads.',
    icon: Inbox,
    related: ['work', 'integrations'],
    updatedAt: '2026-11-03',
    sections: [
      {
        title: 'Get your first cited answer',
        body: 'Start with one source you are allowed to share. You do not need to connect every tool or invite teammates.',
        items: [
          'Open Home and capture a short note about a real project, including a decision or next step. Alternatively, upload an existing document in Documents.',
          'Choose who can see it before saving. Wait for processing; if a document fails, open its status and retry or use a supported file.',
          'Open Ask and ask a specific question the source can answer, such as “What next step did we agree for this project?”',
          'Open the answer’s citation and check that it supports the claim. If no evidence is found, check source visibility and processing before adding more connections.',
        ],
        appLink: { href: '/app', label: 'Start on Home' },
      },

      {
        title: 'What gets captured',
        body: 'Timeline preserves selected notes and source records as events, extracts facts, and can propose objects or tasks for review. Every searchable citation stays linked to the captured source.',
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
        title: 'Connections, sources and evidence',
        body: 'A connection authorizes access to a provider account. A source is the channel, project, folder or other resource selected for capture. Captured records become evidence that Ask can cite after processing. Connecting an account alone does not import everything.',
        items: [
          'Check source selection and team visibility before activating capture.',
          'Timeline’s stored record is separate from the original tool; disconnecting does not erase earlier captures.',
          'A proposed change is a suggestion for review. Approving it updates Timeline’s work record. Enabled external tools may have separate effects in other services.',
        ],
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
    updatedAt: '2026-11-03',
    title: 'Work surface',
    description:
      'Use tasks, boards, objects, the daily update, on-demand updates and handoffs that stay current from evidence.',
    icon: ClipboardList,
    related: ['capture', 'objects', 'boards'],
    sections: [
      {
        title: 'What Work is',
        body: 'Work is the operating surface The Timeline keeps current from captured evidence. The daily update, on-demand updates and handoffs are generated from the current work state with citations. It brings tasks, boards, objects, comments, updates and handoffs together without asking teammates to maintain a separate tracker.',
        items: [
          'Open Work to find tasks assigned to you and work that needs attention.',
          'Open a task or object to inspect its source evidence before changing status, owner or due date.',
          'Pin frequently used objects, boards or documents so you can return to them from Home.',
          'Review proposed changes in Approvals. Accept the changes you agree with; reject unsupported suggestions.',
          'Work → Digests lists every daily update as collapsed rows so a teammate can open a specific day, then follow citations to check the underlying work.',
          'Use Ask about a specific project or decision. Check its citations before sharing the answer.',
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
    related: ['capture', 'work', 'agents'],
    updatedAt: '2026-11-09',
    sections: [
      {
        title: 'Request deletion of captured data',
        resourceLinks: [{ href: '/help/support', label: 'Request deletion through support' }],
        body: 'Team owners can request permanent team deletion from Team settings → Advanced. Export data you can access first. The request immediately disables access for all members, stops new usage accrual, and requests subscription renewal cancellation. Platform admins review and perform deletion. Only platform admins can restore access before permanent deletion starts. For narrower deletion requests, use /help/support. Disconnecting alone does not erase history.',
        items: [
          'Tell us the workspace name, the connected provider, and whether you want all captured data from that source or a narrower set removed. Identify files by name or link only when needed; do not send passwords, tokens, or copies of private documents.',
          'We verify your identity and workspace authority and confirm the scope. For team-controlled data, we may need the workspace administrator’s instructions; individual rights requests are reviewed separately.',
          'We coordinate stopping affected capture before removal so background work does not recreate the data. Removing a shared personal connection can stop capture in other workspaces, so tell us if only one team is in scope.',
          'We review retained records and derived data, including search indexes, and handle removal manually. We explain any backup expiry, provider follow-up, or justified retention and confirm completed and outstanding work. We do not promise instant removal from every retained copy.',
          'Disconnecting Timeline does not delete the original files in Google Drive.',
        ],
      },
      {
        title: 'Connected sources',
        body: 'First-party integrations and ingest paths can create durable evidence. MCP servers give the agent live reach into approved tools; successful team-shared results become team-visible evidence, while personal-server results stay private to their owner. MCP is not passive provider sync.',
        items: [
          'Google Drive records selected Docs, Sheets, Slides, PDF, and Word changes as cited events. It does not copy those files into the document drive. Removing a personal connection deletes its credentials and disables dependent sources; it does not remove their snapshots or captured history. A team admin can disconnect the team source to clean up its snapshots and temporary extracts. Captured history requires a separate support deletion request.',
          'GitHub and Linear bring engineering and project activity into the operational record.',
          'Monday.com syncs selected boards, generic records, subitems, updates, columns, and WorkDocs.',
          'Slack workspace ingestion syncs selected channels, threads, files, reactions, and edits.',
          'Sentry syncs issue updates, resolved issues, and releases into cited events, evidence clusters, and customer/project associations.',
          'Slack, Telegram, email, and meeting bots are capture surfaces for conversations and calls.',
          'Custom MCP servers expose approved live tools and context to the agent; successful team-shared results become team-visible evidence, while personal-server results stay private to their owner. Passive provider activity still needs native sync or custom ingestion.',
        ],
        appLink: { href: '/app/connections', label: 'Open connections' },
        resourceLinks: [
          { href: 'https://thetimeline.cc/integrations/mcp', label: 'Connect MCP tools' },
        ],
      },
      {
        title: 'Security model',
        body: 'OAuth tokens and bearer secrets are encrypted at rest. Imported snippets are treated as external content before the agent sees them.',
        items: [
          'Admins control team-level source activation.',
          'Connection owners control what provider resources are shared.',
          'For Monday.com, selecting a parent board also captures its classic subitems; hidden “Subitems of …” helper boards are not selected separately.',
          'Personal MCP connections are visible only to their owner.',
          'OAuth grants follow the signed-in member’s current team membership and visibility.',
          'Manual outbound keys represent a team and see team-visible events only.',
        ],
      },
      {
        title: 'Use Timeline from an agent',
        body: 'External agents connect through Timeline’s hosted MCP endpoint. Codex and Claude Code can install the Timeline plugin using the instructions below. Other MCP-compatible clients can connect directly. Give an agent https://thetimeline.cc/agents/setup.md. Already-connected agents read their connection context and follow the canonical coworker skill. Owners/admins can choose this connection’s reporting agreement during OAuth consent, inheriting the workspace default or setting an override. Workspace defaults and later changes live in Connect your agent; capture permission remains separate. The skill finishes setup with a useful cited answer or an approved first brief. Verified owners can create limited provisioning grants from the account menu for unattended creation of new workspaces.',
        items: [
          'The default path uses browser-based OAuth: sign in, choose a team, review the requested scopes, and approve or deny access.',
          'Codex and Claude Code users can install the full plugin from this repository. Other compatible clients can connect to the same production URL directly.',
          'The hosted tools are timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember, timeline.crawl, and timeline.crawl_status. The default OAuth grant is read plus capture (on by default). Capture authorizes timeline.remember; unchecking it issues a read-only grant. Timeline agent access is a separate, optional owner/admin-approved agent:ask scope for paid, proposal-only turns.',
          'Static tla_ team keys remain an Advanced compatibility fallback for manual clients and must never be pasted in chat.',
        ],
        appLink: { href: '/app/connect-agent', label: 'Connect your agent' },
        resourceLinks: [
          {
            href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex',
            label: 'Install in Codex',
          },
          {
            href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-claude-code',
            label: 'Install in Claude Code',
          },
        ],
      },
    ],
  },
  {
    slug: 'agents',
    title: 'Timeline for agents',
    description:
      'Connect Codex, Claude, ChatGPT, Cursor, Grok Bot, Hermes, OpenClaw, or another compatible agent to evidence-backed Timeline work.',
    icon: Bot,
    related: ['integrations', 'work', 'objects'],
    updatedAt: '2026-11-03',
    sections: [
      {
        title: 'Install in Codex or Claude Code',
        body: 'Give your agent https://thetimeline.cc/agents/setup.md, or use the copy-ready prompt for Codex or the repository marketplace commands for Claude Code. Both packages add the general Timeline skill and hosted Streamable HTTP MCP endpoint. The bundled connection uses browser-based OAuth instead of embedding a bearer key.',
        items: [
          'The hosted tools are timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember, timeline.crawl, and timeline.crawl_status.',
          'The same skill adapts to status updates, exact lookups, recaps, and incident analysis without competing triggers.',
          'It distinguishes current canonical state from activity, expands material sources, and preserves citations and uncertainty.',
          'Restart Codex or Claude Code after installation, start a new task or conversation, and complete Timeline sign-in, team selection, and scope consent when prompted.',
        ],
        resourceLinks: [
          {
            href: 'https://thetimeline.cc/agents/setup.md',
            label: 'Agent setup markdown',
          },
          {
            href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-codex',
            label: 'Install in Codex',
          },
          {
            href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#install-in-claude-code',
            label: 'Install in Claude Code',
          },
        ],
      },
      {
        title: 'Connect Timeline MCP',
        body: 'Use the single /api/mcp/server URL with Streamable HTTP. Compatible clients discover Timeline OAuth from the endpoint, then open a browser for explicit sign-in, team selection, and scope consent.',
        items: [
          'The default OAuth grant is read plus capture (on by default). Read follows the signed-in member’s current team membership and visibility, including private and specifically shared evidence that member can access. Uncheck capture for a read-only grant.',
          'Approved AI-app access can be reviewed and revoked from Provider accounts.',
          'Static tla_ team keys remain an Advanced fallback for manual clients and see team-visible data only. Never paste them in chat.',
          'Self-hosted users install the standalone Timeline skill and point their compatible client at their own Timeline origin.',
        ],
        appLink: { href: '/app/me/connections', label: 'Manage approved AI apps' },
        resourceLinks: [
          {
            href: 'https://thetimeline.cc/agents/setup.md',
            label: 'Read agent setup',
          },
          {
            href: 'https://github.com/timborovkov/the-timeline-ai/tree/main/plugins/timeline/skills#connect-timeline-mcp',
            label: 'Read MCP setup',
          },
        ],
      },
      {
        title: 'Know the access boundary',
        body: 'The bundled skill uses timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember, timeline.crawl, and timeline.crawl_status, and preserves citations. The default OAuth grant includes read plus capture (on by default) so timeline.remember can store cited evidence; unchecking capture makes the grant read-only. It cannot invoke timeline.ask. A current team owner or admin may separately approve agent:ask for paid, stateless agent turns; it may call enabled team-shared custom MCP tools with external side effects and can create only Timeline proposals that still require human review.',
        resourceLinks: [
          {
            href: 'https://thetimeline.cc/agents/SKILL.md',
            label: 'Browse the Timeline skill',
          },
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
        body: 'Objects are the durable records Timeline resolves from raw activity. They collect facts, discussion comments, relationships, open tasks, and recent changes in one place.',
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
          'Use object discussion comments for human judgment, @mentions, and extra context. Ping @The Timeline Bot to reply in the thread.',
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
