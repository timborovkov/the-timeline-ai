import { CANONICAL_PUBLIC_ORIGIN } from '@/lib/site-url';

export const AGENT_MARKDOWN_DOCS = ['setup.md', 'SKILL.md', 'provisioning.md'] as const;
export type AgentMarkdownDoc = (typeof AGENT_MARKDOWN_DOCS)[number];

export const AGENT_MARKDOWN_HEADERS = {
  'content-type': 'text/markdown; charset=utf-8',
  'cache-control': 'public, max-age=3600, s-maxage=86400',
} as const;

export const TIMELINE_MCP_SERVER_URL = `${CANONICAL_PUBLIC_ORIGIN}/api/mcp/server`;
export const TIMELINE_AGENT_SETUP_PATH = '/agents/setup.md';
export const TIMELINE_AGENT_SKILL_PATH = '/agents/SKILL.md';
const TIMELINE_INGEST_WEBHOOK_URL = `${CANONICAL_PUBLIC_ORIGIN}/api/webhooks/ingest`;

export const TIMELINE_CURSOR_MCP_CONFIG = { url: TIMELINE_MCP_SERVER_URL } as const;

export const TIMELINE_CURSOR_INSTALL_DEEPLINK =
  'cursor://anysphere.cursor-deeplink/mcp/install?name=timeline&config=eyJ1cmwiOiJodHRwczovL3RoZXRpbWVsaW5lLmNjL2FwaS9tY3Avc2VydmVyIn0=';

export const RETIRED_HOSTED_MCP_TOOL_NAMES = [
  'timeline.retrieve_workspace_context',
  'timeline.search_moments',
  'timeline.list_moments',
  'timeline.get_moment',
  'timeline.search_events',
  'timeline.list_events',
  'timeline.get_event',
  'timeline.search_objects',
  'timeline.list_objects',
  'timeline.get_object',
  'timeline.list_tasks',
  'timeline.search_boards',
  'timeline.search_documents',
  'timeline.search_documents_structured',
  'timeline.list_recent_document_changes',
  'timeline.get_document',
  'timeline.get_document_chunk',
  'timeline.list_calendar_events',
  'timeline.get_calendar_event',
  'timeline.resolve_time_context',
  'timeline.list_integrations',
  'timeline.search_integration_events',
  'timeline.get_integration_resource',
  'timeline.get_entity',
  'timeline.ask_agent',
] as const;

export function isAgentMarkdownDoc(value: string): value is AgentMarkdownDoc {
  return (AGENT_MARKDOWN_DOCS as readonly string[]).includes(value);
}

function agentPublicUrl(siteUrl: string, path: `/${string}`): string {
  return new URL(path, `${new URL(siteUrl).origin}/`).toString();
}

export function buildAgentSetupMarkdown(): string {
  return `# Set up The Timeline

You are connecting your human's agent to The Timeline, their team's auto-updating work record. It is a cited history of decisions, owners and next steps from their chat, email, calls and docs. You will be able to recall it with citations and add new notes to it.

Never ask for, accept or paste any key or token in chat. Sign-in is OAuth in the human's browser. Static \`tla_\` keys belong only under Advanced in Timeline, never in chat.

The hosted MCP server advertises seven tools: \`timeline.search\`, \`timeline.get\`, \`timeline.subject\`, \`timeline.ask\`, \`timeline.remember\`, \`timeline.crawl\`, and \`timeline.crawl_status\`. Website scanning requires explicit permission and the separate \`websites:scan\` scope; it costs 20 source units per captured page. Default OAuth is \`read\` plus \`capture\` (the capture checkbox is on by default). \`timeline.remember\` needs the \`capture\` scope; uncheck it for a read-only grant. \`timeline.ask\` needs \`agent:ask\` (owner or admin only).

## 1. Resume or establish access

First check whether Timeline tools are already available. If connected, call \`timeline.get\` with \`kind="connection"\`, verify the intended team, and skip installation. For product research, use the public documentation without connecting.

For a new customer, the human creates their account in the browser, verifies their email as prompted, and accepts the terms. Their first team is created automatically. Existing customers sign in and select their intended team. The browser returns to connection approval after signup; if a continuation expires, restart authorization from the client rather than creating another account.

A verified existing owner can authorize unattended creation of new workspaces from Account → Agent provisioning. Read [the provisioning API guide](${CANONICAL_PUBLIC_ORIGIN}/agents/provisioning.md) when this is the requested task. A provisioning credential does not access existing teams, create customer accounts, or activate paid plans. Keep all credentials in the client's secret store, never in chat.

## 2. Identify where you run. The steps differ.

**Hosted assistant (ChatGPT, claude.ai, Claude Desktop): install nothing.**
Tell the human to add a custom MCP connector, then stop.

- URL: ${TIMELINE_MCP_SERVER_URL}
- Auth: OAuth
- ChatGPT: Plugins → + → Add custom MCP server → name it "The Timeline" → OAuth → Create as a plugin → install.
- Claude (claude.ai, Desktop): Customize → Connectors → Add custom connector. Free plans get one custom connector.
- They sign in to The Timeline, choose the team, and approve. Capture is on by default so remember works; uncheck it for read-only. Then stop.

**Grok Bot:** add a custom MCP server named "timeline" at ${TIMELINE_MCP_SERVER_URL} using Streamable HTTP and start its OAuth sign-in card. After the human approves, save the skill from ${CANONICAL_PUBLIC_ORIGIN}${TIMELINE_AGENT_SKILL_PATH} into the bot's skill store.

**Local coding agent (Claude Code, Codex, Cursor):**

- Claude Code: \`claude plugin marketplace add timborovkov/the-timeline-ai\` then \`claude plugin install timeline@timeline\`. Or MCP only: \`claude mcp add --transport http timeline ${TIMELINE_MCP_SERVER_URL}\`.
- Codex: \`codex plugin marketplace add timborovkov/the-timeline-ai --ref main --sparse .agents/plugins --sparse plugins/timeline\` then \`codex plugin add timeline@timeline\`. Or MCP only: \`codex mcp add timeline --url "${TIMELINE_MCP_SERVER_URL}"\`.
- Cursor: add \`{"mcpServers":{"timeline":{"url":"${TIMELINE_MCP_SERVER_URL}"}}}\` to \`~/.cursor/mcp.json\`, or open ${TIMELINE_CURSOR_INSTALL_DEEPLINK}. Copy the skill from ${CANONICAL_PUBLIC_ORIGIN}${TIMELINE_AGENT_SKILL_PATH} into \`.cursor/skills/timeline/SKILL.md\`.

Complete the client's OAuth login. For Codex CLI, use \`codex mcp login timeline\` if authentication is still needed. If tools require a client restart or new conversation, give this continuation: "Resume Timeline setup: verify the connection, confirm my reporting preference, and help me make a first useful contribution." Resume after restart; do not claim success before a tool call succeeds.

**Self-hosted agent (Hermes Agent, OpenClaw):**

- Hermes: add this under \`mcp_servers\` in \`~/.hermes/config.yaml\`, then run \`hermes mcp login timeline\` and \`/reload-mcp\`. Save the skill to \`~/.hermes/skills/timeline/SKILL.md\`.

\`\`\`yaml
mcp_servers:
  timeline:
    url: "${TIMELINE_MCP_SERVER_URL}"
    auth: oauth
    trust: untrusted
\`\`\`

- OpenClaw: add this under \`mcp.servers\` in \`~/.openclaw/openclaw.json\`, then run \`openclaw mcp login timeline\` and \`openclaw mcp doctor --probe\`. Save the skill to \`~/.openclaw/workspace/skills/timeline/SKILL.md\`.

\`\`\`json
{
  "mcp": {
    "servers": {
      "timeline": {
        "url": "${TIMELINE_MCP_SERVER_URL}",
        "transport": "streamable-http",
        "auth": "oauth"
      }
    }
  }
}
\`\`\`

**Sandboxed agent:** if ${CANONICAL_PUBLIC_ORIGIN} is unreachable, tell the human the network policy blocks it, offer the hosted-connector route, and stop. Do not retry other hosts.

## 3. Verify and agree how to work

Call \`timeline.get\` with \`kind="connection"\` to confirm the team, scopes, and reporting preference, then \`timeline.search\` with a small bounded limit. An empty result means "No visible evidence found", not a broken connection or proof of an empty workspace.

New OAuth connections inherit the workspace default, initially "On request". During OAuth consent, owners/admins can keep that default or choose an on-request or scoped ongoing agreement for this connection. Members see their effective agreement. Reauthorization preserves the existing setting unless explicitly changed. Briefly confirm the verified workspace, effective reporting mode/work scope, and any missing capture permission. Do not ask again to configure an agreement already established in consent. Reporting depends on the agent following the skill while working; it does not schedule background activity.

For static keys and provisioned workspaces, owners/admins manage preferences in Timeline → Connect your agent → Coworker reporting. Provisioned workspaces remain on request initially. An agent cannot change preferences through MCP. If preferences cannot be read, use on-request reporting. Capture scope is still required to store notes, even when an ongoing agreement exists.

Retrieve bounded context relevant to the user's actual task. When relevant evidence exists, complete a useful first task with a cited answer or brief; do not require creating a note to finish onboarding. With no visible evidence, offer a project brief or handoff from context the user approves for sharing, preview the proposed text, and obtain approval before first capture. Store it once with \`timeline.remember\`, then retrieve its returned event identifier with \`timeline.get\` and show the citation. Search indexing or retrieval can lag; keep the identifier, disclose pending verification, and retry reads rather than repeat capture. If capture fails or is unavailable, say so and continue read-only; re-approve capture only if the user wants it.

Already-connected agents skip installation and consent, read their current connection agreement, and proceed with the task without repeatedly promoting ongoing reporting. Research-only use requires no connection or note. After a restart, resume verification and the task rather than restarting onboarding.

## 4. Optional push methods

Use these only when the human asks you to record something.

- **remember:** one self-contained note per fact cluster. Lead with the subject, then who, the decision, the next step, the owner, and the date. Rate-limited to 30 notes per minute. Needs the \`capture\` scope.
- **Team email:** send, forward, CC or BCC to the team address shown on The Timeline Home → Team email. The sending address must be a team member or an allowed sender.
- **Webhook:** POST text or JSON (1 MB or less) to this Timeline deployment's \`/api/webhooks/ingest\` with \`Authorization: Bearer $TIMELINE_INGEST_TOKEN\`. Hosted Timeline uses ${TIMELINE_INGEST_WEBHOOK_URL}. Self-hosted Timeline must use that deployment's own origin; posting to the hosted URL returns 401. Keep the token in the environment. Never print the token.

Recorded items become cited evidence only. Any proposals still need human approval. Tell the human what was recorded.

## 5. Complete the handoff

Report the verified team, effective reporting agreement, and the result of the first useful task. Suggest a next task supported by the visible evidence. For a new workspace, offer adding a project brief or connecting a source rather than implying historical decisions are already available.
`;
}

export function buildLlmsAgentSetupPointer(siteUrl: string): string {
  return `Setting up an agent? Read ${agentPublicUrl(siteUrl, TIMELINE_AGENT_SETUP_PATH)} and follow it.`;
}

export function buildLlmsForAgentsSection(siteUrl: string): string[] {
  return [
    '## For agents',
    `- [Agent setup](${agentPublicUrl(siteUrl, TIMELINE_AGENT_SETUP_PATH)}): connect over MCP, install the skill, push new memory`,
    `- [MCP endpoint](${agentPublicUrl(siteUrl, '/api/mcp/server')}): Streamable HTTP, OAuth (read; optional capture and agent:ask)`,
    `- [Timeline skill](${agentPublicUrl(siteUrl, TIMELINE_AGENT_SKILL_PATH)}): how to recall with citations and add notes`,
    `- [Agents help](${agentPublicUrl(siteUrl, '/help/agents')}): human install guide for Codex, Claude Code, and other MCP clients`,
    '',
  ];
}
