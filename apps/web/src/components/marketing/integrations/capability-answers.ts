export const MEETING_CAPTURE_FAQ = {
  question: 'Do we have to invite a bot to meetings?',
  answer:
    'No. You can invite Timeline to a supported call to capture a transcript, or upload existing notes or a text transcript as a document. Uploads follow the document workflow. Support for a bot joining a call is separate from importing transcripts from another meeting tool.',
} as const;

export const INTEGRATION_CONNECTION_MODES = [
  {
    title: 'Native sync',
    body: 'Sync supported records from selected sources into your work record. Each provider page explains what is captured and which actions are available.',
    links: [{ label: 'Browse native integrations', href: '/integrations#native' }],
  },
  {
    title: 'Activity capture',
    body: 'Configured Slack channels and linked Telegram groups capture supported new activity automatically. You can also add notes, forward email, upload documents, capture a supported call, send a webhook or scan a public website.',
    links: [{ label: 'Browse capture options', href: '/integrations#capture-surfaces' }],
  },
  {
    title: 'Live lookup',
    body: 'Enabled MCP tools can look up provider information when you ask, without importing tool history. Figma desktop MCP requires Timeline on the same machine.',
    links: [{ label: 'Connect MCP tools', href: '/integrations/mcp' }],
  },
] as const;

export const INTEGRATION_CONNECTION_DETAILS = [
  {
    title: 'Historical coverage',
    body: 'Available history varies by connector and record type. GitHub scans up to 2,000 default-branch commits initially. Linear field-change history starts when Timeline begins observing a selected team.',
    links: [
      { label: 'GitHub limits', href: '/integrations/github#limitations' },
      { label: 'Linear limits', href: '/integrations/linear#limitations' },
    ],
  },
  {
    title: 'Permissions',
    body: 'For native sync, a connection owner shares selected sources and a team admin activates them. Captured records follow Timeline visibility rules. Live lookups use the permissions of the enabled tool connection.',
    links: [{ label: 'Security & privacy', href: '/trust' }],
  },
] as const;

export const INTEGRATION_CAPABILITY_ANSWERS = [
  ...INTEGRATION_CONNECTION_MODES,
  ...INTEGRATION_CONNECTION_DETAILS,
] as const;
