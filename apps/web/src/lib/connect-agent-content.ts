import {
  TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
  TIMELINE_HOSTED_MCP_TOOLS,
  TIMELINE_PLUGIN_INSTALL_PROMPT,
} from '@/lib/agent-install-content';
import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

export const CONNECT_AGENT_HREF = '/app/connect-agent';
export const CONNECT_AGENT_SKILL_HREF = '/app/connect-agent/skill';
const LLMS_TXT_URL = `${CANONICAL_PUBLIC_ORIGIN}/llms.txt`;
const MCP_SERVER_PATH = '/api/mcp/server';
export const AGENT_MEMORY_WEBHOOK_NAME = 'Agent memory';

export const TIMELINE_MCP_TOOLS = TIMELINE_HOSTED_MCP_TOOLS;

export const CONNECT_AGENT_SETUP_PROMPT = `Set up The Timeline - ${LLMS_TXT_URL}`;

export function connectAgentTeamPrompt(teamEmail: string | null): string {
  if (!teamEmail) return CONNECT_AGENT_SETUP_PROMPT;
  return `${CONNECT_AGENT_SETUP_PROMPT}\nTeam email: ${teamEmail}`;
}

export function mcpServerUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}${MCP_SERVER_PATH}`;
}

export function ingestWebhookUrl(origin: string, plaintext: string): string {
  return `${origin.replace(/\/$/, '')}/api/webhooks/ingest/${plaintext}`;
}

export function ingestWebhookCurlExample(url: string): string {
  return `curl -X POST ${url} \\
  -H 'Content-Type: application/json' \\
  -d '{"text":"Remember that the launch moved to Thursday."}'`;
}

export function remoteJsonConfig(mcpUrl: string, bearer?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        timeline: {
          type: 'streamable-http',
          url: mcpUrl,
          headers: {
            Authorization: `Bearer ${bearer ?? '<create a key first>'}`,
          },
        },
      },
    },
    null,
    2,
  );
}

export function oauthCommand(mcpUrl: string): string {
  return `codex mcp add timeline --url "${mcpUrl}"`;
}

export function cursorMcpInstallUrl(mcpUrl: string): string {
  const config = globalThis.btoa(JSON.stringify({ url: mcpUrl }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent('timeline')}&config=${encodeURIComponent(config)}`;
}

export function chatGptConnectorDetails(mcpUrl: string): string {
  return [
    'Settings → Apps',
    'Create an app or add a connector',
    'App name: Timeline',
    `MCP server URL: ${mcpUrl}`,
    'Protocol: Streamable HTTP',
    'Sign in with Timeline OAuth when prompted',
  ].join('\n');
}

export type ConnectAgentId =
  'claude-code' | 'codex' | 'chatgpt' | 'claude' | 'cursor' | 'grok' | 'hermes' | 'openclaw';

export interface ConnectAgentGuide {
  id: ConnectAgentId;
  label: string;
  /**
   * Official vendor mark on a white tile, or null for a text-only row.
   * Claude / Claude Code: Simple Icons (Anthropic). ChatGPT / Codex: Simple Icons
   * OpenAI blossom. Cursor: Simple Icons Cursor from cursor.com/brand. Grok Bot:
   * Wikimedia Commons XAI-Logo.svg. Hermes: official PNG from
   * hermes-agent.nousresearch.com. OpenClaw: official pixel lobster.
   */
  logo: string | null;
  summary: string;
  steps: string[];
  copy?: { label: string; value: (mcpUrl: string) => string };
  deeplink?: { label: string; href: (mcpUrl: string) => string };
}

export const CONNECT_AGENT_GUIDES: readonly ConnectAgentGuide[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    logo: '/connectors/claude-code.svg',
    summary: 'Install the plugin, restart, then approve OAuth.',
    steps: [
      'Run the marketplace commands in a terminal.',
      'Fully restart Claude Code and start a new conversation.',
      'Sign in, choose this team, and approve. Capture is on by default for timeline.remember.',
      'Ask Claude to search with timeline.search.',
    ],
    copy: {
      label: 'Copy Claude Code commands',
      value: () => TIMELINE_CLAUDE_PLUGIN_INSTALL_COMMAND,
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    logo: '/connectors/openai.svg',
    summary: 'Paste the install prompt, restart, then finish OAuth.',
    steps: [
      'Paste the Codex install prompt into a new task.',
      'Fully restart Codex and start a new task so the plugin loads.',
      'Complete sign-in, choose this team, and review scopes. Capture is on by default for timeline.remember.',
      'Use timeline.search, timeline.get, and timeline.subject.',
    ],
    copy: { label: 'Copy Codex install prompt', value: () => TIMELINE_PLUGIN_INSTALL_PROMPT },
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    logo: '/connectors/openai.svg',
    summary: 'Add a ChatGPT app connector with Streamable HTTP.',
    steps: [
      'Open ChatGPT Settings, then Apps.',
      'Create an app or add a connector named Timeline.',
      'Paste the Streamable HTTP MCP server URL.',
      'Sign in with Timeline OAuth. Capture is on by default for timeline.remember.',
    ],
    copy: { label: 'Copy ChatGPT details', value: (mcpUrl) => chatGptConnectorDetails(mcpUrl) },
  },
  {
    id: 'claude',
    label: 'Claude Desktop / claude.ai',
    logo: '/connectors/claude.svg',
    summary: 'Add a custom connector, then approve OAuth.',
    steps: [
      'On claude.ai, open Settings → Connectors and add a custom connector.',
      'In Claude Desktop, add a remote MCP server with Streamable HTTP.',
      'Use the hosted Timeline MCP URL. Do not paste a static key unless the client cannot complete OAuth.',
      'Sign in, choose this team, and approve. Capture is on by default for timeline.remember.',
    ],
    copy: { label: 'Copy MCP URL', value: (mcpUrl) => mcpUrl },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    logo: '/connectors/cursor.svg',
    summary: 'Install with the Cursor deeplink, then complete OAuth.',
    steps: [
      'Click Add to Cursor, or open Settings → MCP and add a new server.',
      'Cursor opens the hosted Timeline MCP URL over Streamable HTTP.',
      'Sign in, choose this team, and approve. Capture is on by default for timeline.remember.',
      'Start a new agent chat and call timeline.search.',
    ],
    copy: { label: 'Copy MCP URL', value: (mcpUrl) => mcpUrl },
    deeplink: { label: 'Add to Cursor', href: (mcpUrl) => cursorMcpInstallUrl(mcpUrl) },
  },
  {
    id: 'grok',
    label: 'Grok Bot',
    logo: '/connectors/xai.svg',
    summary: 'Add a remote Streamable HTTP server, then approve OAuth.',
    steps: [
      'Open Grok Bot settings and add an MCP server.',
      'Choose Streamable HTTP and paste the Timeline MCP URL.',
      'Sign in with Timeline OAuth, choose this team. Capture is on by default for timeline.remember.',
      'Ask Grok to use timeline.search.',
    ],
    copy: { label: 'Copy MCP URL', value: (mcpUrl) => mcpUrl },
  },
  {
    id: 'hermes',
    label: 'Hermes',
    logo: '/connectors/hermes.png',
    summary: 'Point Hermes at the hosted MCP URL and finish OAuth.',
    steps: [
      'Open Hermes MCP or tools settings.',
      'Add a remote Streamable HTTP server named Timeline.',
      'Paste the hosted MCP URL. Prefer OAuth; do not paste a tla_ key into chat.',
      'Approve access. Capture is on by default for timeline.remember.',
    ],
    copy: { label: 'Copy MCP URL', value: (mcpUrl) => mcpUrl },
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    logo: '/connectors/openclaw.svg',
    summary: 'Add the hosted URL as a remote MCP server, then complete OAuth.',
    steps: [
      'Open OpenClaw MCP configuration.',
      'Add a remote server with Streamable HTTP and the Timeline MCP URL.',
      'Complete the browser sign-in and choose this team.',
      'Grant read and capture (on by default) for remember. Grant agent:ask only for paid Timeline agent turns.',
    ],
    copy: { label: 'Copy MCP URL', value: (mcpUrl) => mcpUrl },
  },
] as const;

export function mcpScopeLabel(scope: string): string {
  if (scope === 'read') return 'Read';
  if (scope === 'capture') return 'Remember';
  if (scope === 'agent:ask') return 'Ask';
  return scope;
}
