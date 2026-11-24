import { CONNECTORS } from '@/components/marketing/integrations/connector-content';

export const MEETING_CAPTURE_FAQ = {
  question: 'Do we have to invite a bot to meetings?',
  answer:
    'No. You can invite Timeline to a supported call to capture a transcript, or upload existing notes or a text transcript as a document. Uploads follow the document workflow. Support for a bot joining a call is separate from importing transcripts from another meeting tool.',
} as const;

export const INTEGRATION_CAPABILITY_ANSWERS = [
  {
    title: 'Native sync',
    body: `Bring supported records from selected, activated sources into a cited work history. Each provider page describes what is copied and which actions are supported. Native sync is available for ${CONNECTORS.map(({ name }) => name).join(', ')}.`,
  },
  {
    title: 'Deliberate capture',
    body: 'Configured Slack channels and linked Telegram groups capture supported new activity automatically. You can also add explicit notes, forward email, upload documents, capture a supported call, send a webhook or scan a public website.',
  },
  {
    title: 'Live lookup',
    body: 'Enabled hosted MCP tools can look up provider information when you ask, without importing tool history. Figma desktop MCP requires Timeline on the same machine.',
    links: [{ label: 'Connect MCP tools', href: '/integrations/mcp' }],
  },
  {
    title: 'Historical coverage',
    body: 'Backfill and reconciliation vary by connector and record type. For example, GitHub caps the initial default-branch scan at 2,000 commits, and Linear field-change history starts when Timeline begins observing a selected team.',
  },
  {
    title: 'Permissions',
    body: 'For native sync, a connection owner shares selected sources and a team admin activates them. Captured records follow Timeline visibility rules. Live lookups use the permissions of the enabled tool connection.',
  },
] as const;
