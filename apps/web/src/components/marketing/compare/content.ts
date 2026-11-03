export const COMPARE_HUB_ROUTE = '/compare' as const;

type CompareSlug = 'hubspot' | 'jira' | 'linear' | 'notion';

export interface CompareTool {
  slug: CompareSlug;
  route: `/compare/${CompareSlug}`;
  name: string;
  navLabel: string;
  logo: `/connectors/${string}.svg`;
  statusLabel: string;
  title: string;
  summary: string;
  keepLine: string;
  today: string;
  later: string;
  relatedHref: `/integrations/${string}` | '/integrations';
  relatedLabel: string;
}

export const COMPARE_HUB = {
  route: COMPARE_HUB_ROUTE,
  title: 'Keep the tools you already use.',
  summary:
    'The Timeline sits beside HubSpot, Jira, Linear, Notion and the rest of your stack. Keep working there. Timeline keeps the conversation record current, and looks up or syncs what it can today.',
  seoTitle: 'Works with HubSpot, Jira, Linear and Notion',
  seoDescription:
    'Keep HubSpot, Jira, Linear and Notion. Linear syncs into The Timeline today, Jira and Notion are available through MCP lookup, and HubSpot ingest is coming soon.',
} as const;

export const COMPARE_TOOLS: readonly CompareTool[] = [
  {
    slug: 'hubspot',
    route: '/compare/hubspot',
    name: 'HubSpot',
    navLabel: 'Works with HubSpot',
    logo: '/connectors/hubspot.svg',
    statusLabel: 'Coming soon',
    title: 'Keep HubSpot. Timeline covers the conversation record.',
    summary:
      'If HubSpot already holds the pipeline, keep it. The Timeline writes down what was said in Slack or Telegram, email and calls, so the CRM is not the only place a promise can live.',
    keepLine: 'HubSpot remains the CRM. Timeline does not replace it or sync deals today.',
    today:
      'Send work to Timeline from Slack, Telegram, email and calls. Ask what was promised, with the source for every line. People, company and deal records can live in Timeline while HubSpot stays your CRM.',
    later:
      'Native HubSpot, Attio and Pipedrive ingest is coming soon. Until then, Timeline does not sync HubSpot companies, contacts, deals or tickets.',
    relatedHref: '/integrations',
    relatedLabel: 'See current integrations',
  },
  {
    slug: 'jira',
    route: '/compare/jira',
    name: 'Jira',
    navLabel: 'Works with Jira',
    logo: '/connectors/jira.svg',
    statusLabel: 'MCP lookup',
    title: 'Keep Jira. Look issues up when you ask.',
    summary:
      'Jira stays the issue tracker. When you ask Timeline a question, enabled Atlassian MCP can look up issues, sprints and related Confluence pages live. Native Jira ingest is planned.',
    keepLine: 'Jira remains the source of issues, sprints and workflows.',
    today:
      'Connect Atlassian MCP for live lookup from Ask and from agents. Timeline does not ingest Jira history into the work record by default. Conversation evidence still comes from Slack, Telegram, email and calls.',
    later:
      'Native Jira issue, sprint, comment and workflow ingestion is planned. Until then, Jira is queryable through MCP rather than captured as durable Timeline events.',
    relatedHref: '/integrations',
    relatedLabel: 'See current integrations',
  },
  {
    slug: 'linear',
    route: '/compare/linear',
    name: 'Linear',
    navLabel: 'Works with Linear',
    logo: '/connectors/linear.svg',
    statusLabel: 'Native sync',
    title: 'Keep Linear. Selected issues already sync.',
    summary:
      'Linear stays the issue tracker. Choose which teams or projects belong in Timeline; issue updates become cited events next to the conversation record.',
    keepLine:
      'Linear remains the source of issues. Timeline stores the selected copies you choose to preserve.',
    today:
      'The native Linear integration syncs selected issue updates into The Timeline. Ask what blocked a project and inspect the Linear event beside the Slack thread or call that named it.',
    later: 'Keep using Linear for issue workflow, boards, cycles and assignees.',
    relatedHref: '/integrations/linear',
    relatedLabel: 'Linear integration',
  },
  {
    slug: 'notion',
    route: '/compare/notion',
    name: 'Notion',
    navLabel: 'Works with Notion',
    logo: '/connectors/notion.svg',
    statusLabel: 'MCP lookup',
    title: 'Keep Notion. Search it when you ask.',
    summary:
      'Notion stays the wiki. Enabled Notion MCP can search pages, databases and comments live when you ask Timeline. Native page ingest is planned.',
    keepLine: 'Notion remains the source of pages and databases.',
    today:
      'Connect Notion MCP for live lookup from Ask and from agents. Timeline does not ingest Notion history into the work record by default. Conversation evidence still comes from Slack, Telegram, email and calls.',
    later:
      'Native Notion page, database, comment and revision ingestion is planned. Until then, Notion is queryable through MCP rather than captured as durable Timeline events.',
    relatedHref: '/integrations',
    relatedLabel: 'See current integrations',
  },
];

export function findCompareTool(slug: string): CompareTool | undefined {
  return COMPARE_TOOLS.find((tool) => tool.slug === slug);
}

export function findCompareToolByRoute(route: string): CompareTool | undefined {
  return COMPARE_TOOLS.find((tool) => tool.route === route);
}
