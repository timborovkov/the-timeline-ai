import { getConnectorCapabilityTiers } from '@/components/marketing/integrations/connector-content';

export const MCP_GUIDE_ROUTE = '/integrations/mcp' as const;
export const MCP_GUIDE_NAV_LABEL = 'Connect MCP tools';

const REVIEW_DATE = '2026-11-06' as const;

/** Hosted Agent-tools catalog labels; keep in lockstep with listCatalog `mcp_available`. */
export const MCP_GUIDE_HOSTED_TOOL_NAMES = ['Notion', 'Jira', 'Confluence', 'Stripe'] as const;
/** Local-desktop catalog labels; keep in lockstep with listCatalog `mcp_local`. */
export const MCP_GUIDE_LOCAL_TOOL_NAMES = ['Figma'] as const;

export function catalogNames(list: readonly string[]): string {
  if (list.length === 0) return '';
  if (list.length === 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')}, and ${list.at(-1)}`;
}

export function getMcpGuideCatalog() {
  const tiers = getConnectorCapabilityTiers();
  return {
    hostedTools: tiers.mcpAccess,
    hostedToolsLabel: catalogNames(tiers.mcpAccess),
    localDesktopTools: tiers.localDesktopAccess,
    localDesktopToolsLabel: catalogNames(tiers.localDesktopAccess),
  };
}

export const MCP_GUIDE_PAGE = {
  route: MCP_GUIDE_ROUTE,
  navLabel: MCP_GUIDE_NAV_LABEL,
  kicker: 'Agent tools',
  title: 'Connect MCP tools to The Timeline Agent.',
  summary:
    'Third-party MCP servers add live tools The Timeline Agent can call when you ask. They are not native ongoing sync or capture, and they are not the same as connecting an external agent to Timeline.',
  seoTitle: 'Connect MCP tools to The Timeline Agent',
  seoDescription:
    'Connect third-party MCP servers so The Timeline Agent can call live tools. This is distinct from native Slack, Telegram, Drive, GitHub, Linear, Monday.com, and Sentry sync, and from external agents that consume Timeline over MCP.',
  lastReviewed: REVIEW_DATE,
  distinction: {
    title: 'Two different MCP directions',
    inboundTitle: 'The Timeline Agent calling other tools',
    inboundBody:
      'This page is about inbound agent tools: MCP servers you connect so The Timeline Agent can look up or act in another product during a question. Results are live lookups, not a stored chronology from that product.',
    outboundTitle: 'Other agents calling Timeline',
    outboundBody:
      'External agents such as Claude, Cursor, or Codex can read a Timeline team through Timeline’s own MCP endpoint. That setup lives on the Agents page. It does not add third-party tools to The Timeline Agent.',
  },
  setup: {
    title: 'Where teams connect servers today',
    intro:
      'Connecting MCP servers is self-serve in the product. It is not an operator-only env-file setup for customers.',
    teamTitle: 'Team-shared servers',
    teamBody:
      'Owners and admins open Connections, then Agent tools, then Agent MCP servers. From there they can connect a catalog tool or add a custom server for the team. Successful calls from team-shared servers can be captured as team-visible evidence.',
    teamHref: '/app/connections/agent-tools',
    teamLabel: 'Open Agent tools',
    personalTitle: 'Personal servers',
    personalBody:
      'Any member can add personal MCP servers. Only that member can see or use them, and only in chats they start. Personal results stay private to the owner. Team-shared servers stay managed in Connections.',
    personalHref: '/app/me/mcp-servers',
    personalLabel: 'Open personal MCP servers',
    formTitle: 'What the add form asks for',
    formBody:
      'A custom server needs a server name, a server URL, and an authentication choice. The form offers None, Bearer token, Custom header, or OAuth. After a server is added, the Agent MCP servers list can enable, disable, or remove it.',
  },
  catalog: {
    title: 'Catalog tools are live lookups',
    intro:
      'Some products appear in the Agent tools catalog as shortcuts to that vendor’s hosted MCP server. Connecting them still uses the MCP path above. Timeline does not ingest those products into the work record by default.',
    localTitle: 'Local desktop MCP',
    localBody:
      'Local-only catalog entries require Timeline and the MCP server on the same computer. They are not connectable from hosted Timeline.',
  },
  notNative: {
    title: 'Not native sync or capture',
    body: 'Native Slack, Google Drive, GitHub, Linear, Monday.com, and Sentry connections, plus Telegram capture, write selected records into Timeline over time. MCP tools do not replace that. If Ask should look something up live in another product, connect an MCP server. If that product’s history should sit in the work record, you need a native integration or another capture path.',
  },
  limits: {
    title: 'What this page does not claim',
    items: [
      'Custom MCP server capacity follows the team’s plan. The Free plan does not include custom MCP servers.',
      'Team-shared catalog and custom servers are an admin action. Personal servers are a member action.',
      'Enabled tools are called when the agent needs them. MCP is not a background sync job.',
      'Vendor-hosted catalog URLs and OAuth or token prompts belong to those vendors. Timeline stores connection secrets encrypted at rest.',
    ],
  },
} as const;

export const MCP_GUIDE_RELATED = [
  { href: '/integrations', label: 'Integrations hub' },
  { href: '/integrations/jira', label: 'Jira' },
  { href: '/integrations/notion', label: 'Notion' },
  { href: '/agents', label: 'Agents' },
  { href: '/help/integrations', label: 'Help · Integrations' },
] as const;
