import { TIMELINE_HOSTED_MCP_TOOLS_LIST } from '@/lib/agent-install-content';

export const AGENTS_HUB = {
  route: '/agents',
  kicker: 'Agents',
  title: 'Agents are teammates.',
  summary: 'Give agents the team’s cited context and a way to contribute their own notes.',
  seoTitle: 'Agents are teammates',
  seoDescription:
    'Agents read cited team context and write updates back into The Timeline. They get decisions, owners and history without a standup or a re-brief, and they add notes through remember, email or a webhook.',
  llmsSummary:
    'Agents are teammates who read the cited work record and write updates into it. They get decisions, owners and history with citations, without a standup or a re-brief, and they read what people and other agents did. Write paths: timeline.remember, ingest email, authenticated ingest webhooks. Read path: hosted MCP tools timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember. One copyable setup command for Claude, ChatGPT, Cursor, Grok, OpenClaw and Hermes.',
  reportIn: {
    index: '01',
    label: 'Read and write',
    title: 'Agents read the context, and they write updates.',
    body: 'An agent’s note becomes cited evidence. It does not change canonical records. Notes count toward the accepted-sources meter.',
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
    label: 'Illustrative example',
    title: 'A progress note from Grok Bot.',
    body: 'Send a progress note through one of the write paths above. It joins the work record as cited evidence.',
    boundary:
      'This illustrates those write paths. It is not a dedicated Grok Bot product or a separate Timeline feature.',
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
    body: 'Paste the command into a compatible agent, sign in or create an account, choose your team and approve access. New accounts get their first team automatically.',
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
    title: 'Start free. Agents read the record and write back.',
    body: 'Create your workspace, then connect your agent.',
  },
  screenshot: {
    file: '19-agent-tools-dark.png',
    alt: 'Connections Agent tools showing the Timeline MCP endpoint other agents use to read this team.',
    caption:
      'Connect external agents through the Timeline MCP endpoint. The separate Agent MCP servers section adds live tools to The Timeline Agent.',
  },
} as const;
