import { TIMELINE_HOSTED_MCP_TOOLS_LIST } from '@/lib/agent-install-content';

export const AGENTS_HUB = {
  route: '/agents',
  kicker: 'Agents',
  title: 'Give agents the context to continue the work.',
  summary:
    'Agents can recover why a decision was made, do their part, and leave an attributed progress note for the next person or agent.',
  seoTitle: 'AI agents and the shared work record',
  seoDescription:
    'Agents read cited team context and add attributed updates to The Timeline. They get decisions, owners and history from the shared work record, and they add notes through remember, email or a webhook.',
  llmsSummary:
    'External agents read the same permitted, cited work record as the team and contribute attributed progress notes. Write paths: timeline.remember, ingest email, authenticated ingest webhooks. Read path: hosted MCP tools timeline.search, timeline.get, timeline.subject, and timeline.ask. One copyable setup command for Claude, ChatGPT, Cursor, Grok, OpenClaw and Hermes.',
  reportIn: {
    index: '01',
    label: 'Read and write',
    title: 'Agents read the context, and they write updates.',
    body: 'An agent’s note becomes attributed evidence. It does not change canonical records directly. A later answer can cite what the agent reported.',
    paths: [
      {
        name: 'timeline.remember',
        body: 'Stores a cited note. OAuth capture is a separate consent checkbox, on by default, so remember works; uncheck it for a read-only grant.',
      },
      {
        name: 'Ingest email',
        body: 'Forward, CC or BCC mail to the team inbound address. The sending address must be a team member or an allowed sender.',
      },
      {
        name: 'Ingest webhook',
        body: 'Authenticated POST /api/webhooks/ingest accepts a tli_ bearer key or a one-time URL.',
      },
    ],
  },
  example: {
    label: 'Example',
    title: 'An agent leaves the next step open.',
    body: 'After checking the staging login flow, the agent records what it tried and leaves customer verification open. A later answer cites the note as the agent’s report.',
    boundary:
      'The staging result comes from the agent’s note. The customer outcome still needs verification.',
  },
  readOut: {
    index: '02',
    label: 'Read out',
    title: 'Agents read the same cited record.',
    body: 'Sign in, choose a team, and approve scopes in the browser. Static team keys (tla_) are a manual fallback and see team-visible data only.',
    endpoint: 'https://thetimeline.cc/api/mcp/server',
    toolsIntro: `The hosted server advertises seven tools: ${TIMELINE_HOSTED_MCP_TOOLS_LIST}.`,
    facts: [
      'timeline.ask needs a separate owner or admin agent:ask scope.',
      'The Timeline skill lives in plugins/timeline and is bundled for Codex and Claude Code.',
    ],
  },
  setupPrerequisite: {
    title: 'Account and team first',
    body: 'Paste the command into a compatible agent, sign in or create an account, name your team on Welcome if you are new, then choose your team and approve access. Invite-only accounts join an existing team with no separate workspace.',
    distinction:
      'Connecting an external agent does not import chat or email history and does not add third-party tools to The Timeline Agent. For those tools, use',
    mcpHref: '/integrations/mcp' as const,
    mcpLabel: 'Connect MCP tools for live lookups',
  },
  installGuide: {
    href: '/help/agents',
    label: 'Full agent install guide',
  },
  cta: {
    title: 'Start free. Agents can read the record and add notes.',
    body: 'Create your workspace, then connect your agent.',
  },
  screenshot: {
    file: '19-agent-tools-dark.png',
    alt: 'Connections Agent tools showing the Timeline MCP endpoint other agents use to read this team.',
    caption:
      'Connect external agents through the Timeline MCP endpoint. The separate Agent MCP servers section adds live tools to The Timeline Agent.',
  },
} as const;
