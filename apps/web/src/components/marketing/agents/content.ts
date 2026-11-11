import { TIMELINE_HOSTED_MCP_TOOLS_LIST } from '@/lib/agent-install-content';

export const AGENTS_HUB = {
  route: '/agents',
  kicker: 'Agents',
  title: 'Agents are teammates.',
  summary:
    'They report on what they do. The Timeline cites and organizes that work like any other source.',
  seoTitle: 'Agents are teammates',
  seoDescription:
    'Agents report into The Timeline like teammates. They write notes through remember, email or a webhook, and read cited context over MCP. One setup line connects them.',
  llmsSummary:
    'Agents are teammates who report into the cited work record and read it back. Write paths: timeline.remember, ingest email, authenticated ingest webhooks. Read path: hosted MCP tools timeline.search, timeline.get, timeline.subject, timeline.ask, timeline.remember. One copyable setup command for Claude, ChatGPT, Cursor, Grok, OpenClaw and Hermes.',
  reportIn: {
    index: '01',
    label: 'Report in',
    title: 'Agents write into the work record.',
    body: 'A note from an agent is cited ingest evidence, the same way a forwarded email or a webhook payload is. It counts toward the accepted-sources meter. It does not change canonical records.',
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
    body: 'Grok Bot, or any compatible agent, can send a short progress note through timeline.remember, team ingest email, or an authenticated ingest webhook. That note lands as cited evidence in the work record.',
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
    body: 'Paste the line into a compatible agent. If you already have a Timeline team, sign in and choose it. If you are new, create an account first — we create your first team automatically — then approve access. Connecting does not import Slack, Telegram or email history.',
    distinction:
      'This lets an external agent read Timeline and write cited notes. It does not add third-party tools to The Timeline Agent.',
    mcpHref: '/integrations/mcp' as const,
    mcpLabel: 'Connect MCP tools for live lookups',
  },
  installGuide: {
    href: '/help/agents',
    label: 'Full agent install guide',
  },
  cta: {
    title: 'Start free, then let an agent write back.',
    body: 'Create a workspace. Agents read the cited record over MCP, and they add notes through remember, email or a webhook.',
  },
  screenshot: {
    file: '19-agent-tools-dark.png',
    alt: 'Connections Agent tools showing the Timeline MCP endpoint other agents use to read this team.',
    caption:
      'The Timeline MCP endpoint other agents use to read this team. Agent MCP servers on the same screen are inbound live lookup for The Timeline Agent, covered on Connect MCP tools.',
  },
} as const;
