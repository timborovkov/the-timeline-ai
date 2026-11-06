export const WORKS_WITH_SLUGS = [
  'linear',
  'jira',
  'notion',
  'hubspot',
  'attio',
  'pipedrive',
] as const;

type WorksWithSlug = (typeof WORKS_WITH_SLUGS)[number];

type WorksWithStatus = 'native-sync' | 'mcp-lookup' | 'coming-soon';

export interface WorksWithTool {
  slug: WorksWithSlug;
  route: `/integrations/${WorksWithSlug}`;
  name: string;
  navLabel: string;
  logo: `/connectors/${string}.svg`;
  status: WorksWithStatus;
  statusLabel: string;
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  howItPlugsIn: string;
  today: string;
  later: string;
  gettingStarted: string;
  whenAloneBetter: string;
  nativeConnector: boolean;
}

export const WORKS_WITH_TOOLS: readonly WorksWithTool[] = [
  {
    slug: 'linear',
    route: '/integrations/linear',
    name: 'Linear',
    navLabel: 'Linear · Native sync',
    logo: '/connectors/linear.svg',
    status: 'native-sync',
    statusLabel: 'Native sync',
    title: 'Linear issues sit beside the conversation that moved them.',
    summary:
      'Choose which Linear teams belong in The Timeline. Selected issue updates become cited events next to Slack, Telegram, email and calls.',
    seoTitle: 'Linear integration for cited project history',
    seoDescription:
      'Sync Linear issues, comments, status, assignee, priority, and project changes into The Timeline for cited project updates and answers.',
    howItPlugsIn:
      'Connect Linear with a person-owned OAuth connection, share selected teams, and have a Timeline admin activate those sources. Issue, comment, status, assignee, priority and project changes from those teams become immutable Timeline events. Linear stays the place you create, assign and move work.',
    today:
      'Native Linear ingest is live for selected teams. Ask what blocked a project and inspect the Linear event beside the Slack thread or call that named it. Timeline does not create, edit, assign or reprioritize Linear issues through this sync.',
    later: 'Keep using Linear for issue workflow, boards, cycles and assignees.',
    gettingStarted:
      'If you are still proving the work record, you may not need Linear yet. Start with one Slack channel or Telegram group. Add Linear when issue movement should sit in the same chronology as the conversation.',
    whenAloneBetter:
      'Stay in Linear alone when issue tracking is the whole job: boards, cycles, assignees and workflow. The Timeline is the conversation and cross-tool record around that work, not a second issue tracker.',
    nativeConnector: true,
  },
  {
    slug: 'jira',
    route: '/integrations/jira',
    name: 'Jira',
    navLabel: 'Jira · MCP lookup',
    logo: '/connectors/jira.svg',
    status: 'mcp-lookup',
    statusLabel: 'MCP lookup',
    title: 'Look Jira issues up when you ask. Keep Jira as the tracker.',
    summary:
      'Jira stays the issue tracker. Enabled Atlassian MCP can look up issues, sprints and related Confluence pages live when you ask Timeline. Native Jira ingest is planned.',
    seoTitle: 'Jira lookup in The Timeline',
    seoDescription:
      'Connect Atlassian MCP so Ask and agents can look up Jira issues, sprints and related Confluence pages. Native Jira ingest is planned; Timeline does not sync Jira history today.',
    howItPlugsIn:
      'Connect Atlassian MCP from Timeline agent tools. When you ask a question, enabled live tools can query Jira and related Confluence pages. Conversation evidence still comes from Slack, Telegram, email and calls. Jira remains the source of issues, sprints and workflows.',
    today:
      'Hosted Atlassian MCP lookup is available. Timeline does not ingest Jira history into the work record by default. Answers that use Jira do so through a live lookup, not a stored Jira chronology.',
    later:
      'Native Jira issue, sprint, comment and workflow ingestion is planned. Until then, Jira is queryable through MCP rather than captured as durable Timeline events.',
    gettingStarted:
      'You may not need Jira in Timeline yet. Link a Slack channel or Telegram group first. Add Atlassian MCP later if Ask should look up issues that already live in Jira.',
    whenAloneBetter:
      'Stay in Jira alone when Jira workflows, sprints and permissions are the system of record you need, and you do not need a conversation work record beside them.',
    nativeConnector: false,
  },
  {
    slug: 'notion',
    route: '/integrations/notion',
    name: 'Notion',
    navLabel: 'Notion · MCP lookup',
    logo: '/connectors/notion.svg',
    status: 'mcp-lookup',
    statusLabel: 'MCP lookup',
    title: 'Search Notion when you ask. Keep Notion as the wiki.',
    summary:
      'Notion stays the wiki. Enabled Notion MCP can search pages, databases and comments live when you ask Timeline. Native page ingest is planned.',
    seoTitle: 'Notion lookup in The Timeline',
    seoDescription:
      'Connect Notion MCP so Ask and agents can search pages, databases and comments. Native Notion ingest is planned; Timeline does not sync Notion history today.',
    howItPlugsIn:
      'Connect Notion MCP from Timeline agent tools. When you ask a question, enabled live tools can search pages, databases and comments. Conversation evidence still comes from Slack, Telegram, email and calls. Notion remains the source of pages and databases.',
    today:
      'Hosted Notion MCP lookup is available. Timeline does not ingest Notion history into the work record by default. Answers that use Notion do so through a live lookup, not a stored Notion chronology.',
    later:
      'Native Notion page, database, comment and revision ingestion is planned. Until then, Notion is queryable through MCP rather than captured as durable Timeline events.',
    gettingStarted:
      'You may not need Notion in Timeline yet. Start with the conversation record. Add Notion MCP later if Ask should search a wiki that already lives in Notion.',
    whenAloneBetter:
      'Stay in Notion alone when pages and databases are the workspace you need, and you do not need a cited conversation record from Slack, Telegram, email and calls.',
    nativeConnector: false,
  },
  {
    slug: 'hubspot',
    route: '/integrations/hubspot',
    name: 'HubSpot',
    navLabel: 'HubSpot · Coming soon',
    logo: '/connectors/hubspot.svg',
    status: 'coming-soon',
    statusLabel: 'Coming soon',
    title: 'Keep HubSpot. Timeline covers the conversation record.',
    summary:
      'If HubSpot already holds the pipeline, keep it. The Timeline writes down what was said in Slack or Telegram, email and calls, so a promise is not only a CRM note.',
    seoTitle: 'HubSpot and The Timeline',
    seoDescription:
      'Keep HubSpot as the CRM. The Timeline covers the conversation record from Slack, Telegram, email and calls. Native HubSpot ingest is coming soon and is not available today.',
    howItPlugsIn:
      'Today HubSpot does not sync into The Timeline. People, company and deal records can still live in Timeline from the conversation record while HubSpot stays your CRM. Native company, contact, deal, ticket, note and pipeline-event ingest is planned.',
    today:
      'Send work to Timeline from Slack, Telegram, email and calls. Ask what was promised, with the source for every line. Timeline does not sync HubSpot companies, contacts, deals or tickets.',
    later:
      'Native HubSpot ingest is coming soon. Until it ships, there is no HubSpot MCP lookup and no HubSpot history in the work record.',
    gettingStarted:
      'You may not need HubSpot in Timeline yet. Start with one Slack channel or Telegram group. Add a CRM connection later if pipeline objects should join that chronology.',
    whenAloneBetter:
      'Stay in HubSpot alone when the CRM is the whole job: pipeline, contacts and the HubSpot workflows you already run. The Timeline is the conversation record around that work, and it does not sync HubSpot today.',
    nativeConnector: false,
  },
  {
    slug: 'attio',
    route: '/integrations/attio',
    name: 'Attio',
    navLabel: 'Attio · Coming soon',
    logo: '/connectors/attio.svg',
    status: 'coming-soon',
    statusLabel: 'Coming soon',
    title: 'Keep Attio. Timeline covers the conversation record.',
    summary:
      'If Attio already holds people, companies and lists, keep it. The Timeline writes down what was said in Slack or Telegram, email and calls.',
    seoTitle: 'Attio and The Timeline',
    seoDescription:
      'Keep Attio as the CRM. The Timeline covers the conversation record from Slack, Telegram, email and calls. Native Attio ingest is coming soon and is not available today.',
    howItPlugsIn:
      'Today Attio does not sync into The Timeline. Conversation evidence still lands from Slack, Telegram, email and calls. Native people, company, list, note, task and pipeline-event ingest is planned.',
    today:
      'Send work to Timeline from Slack, Telegram, email and calls. Timeline does not sync Attio people, companies, lists or pipeline events.',
    later:
      'Native Attio ingest is coming soon. Until it ships, there is no Attio MCP lookup and no Attio history in the work record.',
    gettingStarted:
      'You may not need Attio in Timeline yet. Start with the conversation record. Add a CRM connection later if Attio objects should join that chronology.',
    whenAloneBetter:
      'Stay in Attio alone when its data model is the CRM you need, and you do not need a cited conversation record beside it. The Timeline does not sync Attio today.',
    nativeConnector: false,
  },
  {
    slug: 'pipedrive',
    route: '/integrations/pipedrive',
    name: 'Pipedrive',
    navLabel: 'Pipedrive · Coming soon',
    logo: '/connectors/pipedrive.svg',
    status: 'coming-soon',
    statusLabel: 'Coming soon',
    title: 'Keep Pipedrive. Timeline covers the conversation record.',
    summary:
      'If Pipedrive already holds the pipeline, keep it. The Timeline writes down what was said in Slack or Telegram, email and calls.',
    seoTitle: 'Pipedrive and The Timeline',
    seoDescription:
      'Keep Pipedrive as the CRM. The Timeline covers the conversation record from Slack, Telegram, email and calls. Native Pipedrive ingest is coming soon and is not available today.',
    howItPlugsIn:
      'Today Pipedrive does not sync into The Timeline. Conversation evidence still lands from Slack, Telegram, email and calls. Native deal, person, organization, activity, note and pipeline-stage ingest is planned.',
    today:
      'Send work to Timeline from Slack, Telegram, email and calls. Timeline does not sync Pipedrive deals, people, organizations or activities.',
    later:
      'Native Pipedrive ingest is coming soon. Until it ships, there is no Pipedrive MCP lookup and no Pipedrive history in the work record.',
    gettingStarted:
      'You may not need Pipedrive in Timeline yet. Start with one Slack channel or Telegram group. Add a CRM connection later if pipeline stages should join that chronology.',
    whenAloneBetter:
      'Stay in Pipedrive alone when the sales pipeline is the whole job. The Timeline is the conversation record around that work, and it does not sync Pipedrive today.',
    nativeConnector: false,
  },
];

export const WORKS_WITH_PAGE_TOOLS = WORKS_WITH_TOOLS.filter((tool) => !tool.nativeConnector);

export function findWorksWithTool(slug: string): WorksWithTool | undefined {
  return WORKS_WITH_TOOLS.find((tool) => tool.slug === slug);
}

export function findWorksWithToolByRoute(route: string): WorksWithTool | undefined {
  return WORKS_WITH_TOOLS.find((tool) => tool.route === route);
}
