export const COMPARE_HUB_ROUTE = '/compare' as const;

export const COMPARE_SLUGS = [
  'the-timeline-vs-day-ai',
  'the-timeline-vs-folk',
  'the-timeline-vs-glean',
  'the-timeline-vs-geekbot',
  'the-timeline-vs-suda',
  'the-timeline-vs-memorycrow',
  'the-timeline-vs-achiral',
] as const;

type CompareSlug = (typeof COMPARE_SLUGS)[number];

export const LEGACY_COMPARE_REDIRECTS = {
  hubspot: '/integrations/hubspot',
  jira: '/integrations/jira',
  linear: '/integrations/linear',
  notion: '/integrations/notion',
} as const;

type LegacyCompareSlug = keyof typeof LEGACY_COMPARE_REDIRECTS;

interface CompareCitation {
  href: `https://${string}`;
  label: string;
}

interface CompareFact {
  claim: string;
  source: CompareCitation;
}

export interface ComparePageContent {
  slug: CompareSlug;
  route: `/compare/${CompareSlug}`;
  name: string;
  navLabel: string;
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  competitorUrl: `https://${string}`;
  facts: readonly CompareFact[];
  timelineSide: string;
  whenCompetitorBetter: string;
}

export const COMPARE_HUB = {
  route: COMPARE_HUB_ROUTE,
  title: 'See how The Timeline sits next to other tools.',
  summary:
    "Looking for Day AI, Folk, Glean, Geekbot, Suda, MemoryCrow or Achiral alternatives? Head-to-head pages cite each competitor's own site. Unverified claims are left out. How existing tools plug in lives under Integrations.",
  seoTitle: 'Compare The Timeline',
  seoDescription:
    "Looking for Day AI, Folk, Glean, Geekbot, Suda, MemoryCrow or Achiral alternatives? Compare each with The Timeline. Facts cite each company's own site.",
} as const;

export const COMPARE_PAGES: readonly ComparePageContent[] = [
  {
    slug: 'the-timeline-vs-day-ai',
    route: '/compare/the-timeline-vs-day-ai',
    name: 'Day AI',
    navLabel: 'The Timeline vs Day AI',
    title: 'The Timeline vs Day AI',
    summary:
      'Day AI is a go-to-market context graph and agent control plane. The Timeline is a Day AI alternative only as a cited work record from Slack, Telegram, email and calls, not as a GTM control plane.',
    seoTitle: 'Day AI alternatives: The Timeline vs Day AI',
    seoDescription:
      'Looking for Day AI alternatives? Compare The Timeline vs Day AI. Day AI publishes a GTM context graph and agent control plane. The Timeline is a cited work record. Facts from day.ai.',
    competitorUrl: 'https://day.ai',
    facts: [
      {
        claim:
          'Day AI describes itself as the Context Graph and Agent Control Plane for GTM, and as the context graph and agent control plane to upgrade a go-to-market harness.',
        source: { href: 'https://day.ai', label: 'day.ai' },
      },
      {
        claim:
          'Customer Memory is an LLM-optimized ontology built from automatically permissioned ingestion of team email, calendar, meetings, and Slack, as one central context graph.',
        source: { href: 'https://day.ai', label: 'day.ai' },
      },
      {
        claim:
          'Day agents have names, job descriptions, and titles, live in an org chart, and “nothing went out without your approval.”',
        source: { href: 'https://day.ai', label: 'day.ai' },
      },
    ],
    timelineSide:
      'The Timeline captures selected Slack, Telegram, email and calls into an auto-updating work record, with the source on every line and a person approving lasting record changes. It is not a GTM agent control plane and does not ship named agents in an org chart.',
    whenCompetitorBetter:
      'Choose Day AI when you want a go-to-market context graph and a roster of named agents that report to people on the sales, success or support team, with approval before outbound. That is the product Day AI publishes on day.ai.',
  },
  {
    slug: 'the-timeline-vs-folk',
    route: '/compare/the-timeline-vs-folk',
    name: 'Folk',
    navLabel: 'The Timeline vs Folk',
    title: 'The Timeline vs Folk',
    summary:
      'Folk is an AI CRM for the sales motion. The Timeline is a Folk alternative only as a cited work record from conversations, not as a prospecting CRM.',
    seoTitle: 'Folk alternatives: The Timeline vs Folk',
    seoDescription:
      'Looking for Folk alternatives? Compare The Timeline vs Folk. Folk publishes an AI CRM for the sales motion. The Timeline is a cited work record, not a prospecting CRM. Facts from folk.app.',
    competitorUrl: 'https://www.folk.app',
    facts: [
      {
        claim: 'Folk describes itself as the AI CRM for your entire sales motion.',
        source: { href: 'https://www.folk.app', label: 'folk.app' },
      },
      {
        claim: 'The Folk homepage offers one platform to prospect, enrich, and qualify contacts.',
        source: { href: 'https://www.folk.app', label: 'folk.app' },
      },
      {
        claim:
          'Folk says you can engage leads across channels and record phone conversations with your own number, then review them in Folk.',
        source: { href: 'https://www.folk.app', label: 'folk.app' },
      },
      {
        claim:
          'Folk publishes a shared sales data model fed by 30+ integrations, plus API and MCP access for agents.',
        source: { href: 'https://www.folk.app', label: 'folk.app' },
      },
    ],
    timelineSide:
      'The Timeline can hold people, company and deal records that come from the conversation record, with human approval before inferred durable changes. Native HubSpot, Attio and Pipedrive ingest is coming soon. Timeline does not prospect, enrich leads, or record sales calls onto a CRM phone number.',
    whenCompetitorBetter:
      "Choose Folk when you want an AI CRM for the sales motion: prospecting, enrichment, multi-channel outreach and calls recorded on Folk's own number. That is the product Folk publishes on folk.app.",
  },
  {
    slug: 'the-timeline-vs-glean',
    route: '/compare/the-timeline-vs-glean',
    name: 'Glean',
    navLabel: 'The Timeline vs Glean',
    title: 'The Timeline vs Glean',
    summary:
      'Glean is enterprise AI over company knowledge at scale. The Timeline is a Glean alternative only as a deliberate work record from the conversations and tools you choose to capture, not as search across hundreds of apps.',
    seoTitle: 'Glean alternatives: The Timeline vs Glean',
    seoDescription:
      'Looking for Glean alternatives? Compare The Timeline vs Glean. Glean publishes enterprise AI over company knowledge. The Timeline is a cited work record from selected conversations. Facts from glean.com.',
    competitorUrl: 'https://www.glean.com',
    facts: [
      {
        claim: 'Glean describes itself as enterprise AI that understands your company.',
        source: { href: 'https://www.glean.com', label: 'glean.com' },
      },
      {
        claim:
          'The Glean homepage lists Slack, Google Drive, Jira, Confluence, SharePoint, GitHub and Salesforce among connected tools, and says it connects to 275+ work apps and data sources.',
        source: { href: 'https://www.glean.com', label: 'glean.com' },
      },
      {
        claim:
          'Glean says access is permission-aware from day one: users only see what they are allowed to see, with Glean Protect and published ISO 42001, HIPAA, TX-RAMP Level 2, SOC 2 Type II, ISO 27001 and GDPR marks.',
        source: { href: 'https://www.glean.com', label: 'glean.com' },
      },
    ],
    timelineSide:
      "The Timeline syncs selected sources you activate (Slack channels, Linear teams, GitHub repositories, and the other native connectors), plus first-party capture from Telegram, email, calls and webhooks. It is not an enterprise search layer across hundreds of apps, and it does not claim Glean's connector count or compliance marks.",
    whenCompetitorBetter:
      'Choose Glean when you need enterprise AI over company knowledge at scale, with permission-aware answers across the tools Glean lists and the controls Glean Protect describes. That is the product Glean publishes on glean.com.',
  },
  {
    slug: 'the-timeline-vs-geekbot',
    route: '/compare/the-timeline-vs-geekbot',
    name: 'Geekbot',
    navLabel: 'The Timeline vs Geekbot',
    title: 'The Timeline vs Geekbot',
    summary:
      'Geekbot runs async standups, polls and surveys in Slack and Microsoft Teams. The Timeline is a Geekbot alternative that writes down what was already said, then answers from that record, rather than running standup questionnaires.',
    seoTitle: 'Geekbot alternatives: The Timeline vs Geekbot',
    seoDescription:
      'Looking for Geekbot alternatives? Compare The Timeline vs Geekbot. Geekbot publishes async standups, polls and surveys in Slack and Teams. The Timeline is a cited work record. Facts from geekbot.com.',
    competitorUrl: 'https://geekbot.com',
    facts: [
      {
        claim:
          'Geekbot describes itself as the easiest way to run standups, polls and surveys in Slack and Microsoft Teams.',
        source: { href: 'https://geekbot.com', label: 'geekbot.com' },
      },
      {
        claim: 'Geekbot is free for teams of up to 10 users, with no credit card required.',
        source: { href: 'https://geekbot.com', label: 'geekbot.com' },
      },
      {
        claim:
          'Geekbot kicks off a standup in Slack or Teams, teammates respond, and updates are shared; scheduled summaries highlight participation, blockers and sentiment.',
        source: { href: 'https://geekbot.com', label: 'geekbot.com' },
      },
    ],
    timelineSide:
      'The Timeline records selected Slack channels, Telegram groups, forwarded email and calls. It can send a daily update from that record. It does not run standup questionnaires, polls or surveys inside Slack or Microsoft Teams, and it does not offer Microsoft Teams chat capture.',
    whenCompetitorBetter:
      'Choose Geekbot when you want a bot to run async standups, polls and surveys in Slack or Microsoft Teams. That is the product Geekbot publishes on geekbot.com.',
  },
  {
    slug: 'the-timeline-vs-suda',
    route: '/compare/the-timeline-vs-suda',
    name: 'Suda',
    navLabel: 'The Timeline vs Suda',
    title: 'The Timeline vs Suda',
    summary:
      'Suda publishes a company brain: a permissioned context graph from tools such as Notion, Slack and Linear that people and AI agents query over MCP. The Timeline is a Suda alternative only as a cited work record from Slack, Telegram, email and calls, with Ask receipts and human approval before lasting changes, not as a 700-source context graph.',
    seoTitle: 'Suda alternatives: The Timeline vs Suda',
    seoDescription:
      'Looking for Suda alternatives? Compare The Timeline vs Suda. Suda publishes a permissioned company-brain context graph for people and AI agents. The Timeline is a cited work record. Facts from suda.so.',
    competitorUrl: 'https://suda.so',
    facts: [
      {
        claim:
          'Suda describes itself as the company brain for a team and enterprise: one permissioned context graph that people and AI agents can read.',
        source: { href: 'https://suda.so/', label: 'suda.so' },
      },
      {
        claim:
          'Suda says it turns what is scattered across tools such as Notion, Slack and Linear into a living context graph, and that it ingests from more than 700 sources.',
        source: { href: 'https://suda.so/', label: 'suda.so' },
      },
      {
        claim:
          'Suda says any AI that speaks MCP can query the graph, and that people can also ask context from Slack.',
        source: { href: 'https://suda.so/', label: 'suda.so' },
      },
      {
        claim:
          'Suda says the graph is self-updating: stale facts retire and conflicting facts resolve automatically.',
        source: { href: 'https://suda.so/', label: 'suda.so' },
      },
      {
        claim:
          'Suda publishes Free at $0 with 1,000 credits and 1 to 5 seats, Business at $20 per user per month with 12,000 credits and up to 50 seats (top-up $10 per 10,000 credits), and custom Enterprise billing.',
        source: { href: 'https://suda.so/', label: 'suda.so' },
      },
    ],
    timelineSide:
      'The Timeline captures selected Slack, Telegram, email and calls into an auto-updating work record of decisions, promises and handoffs, with the source on every line. People Ask in the product or Slack. Agents read that record over MCP and contribute notes through timeline.remember, ingest email or an ingest webhook. Lasting record changes wait for a person to approve them. It is not a 700-source context graph for any MCP client.',
    whenCompetitorBetter:
      'Choose Suda when you want context infrastructure that feeds the agents already in your stack over MCP, with a graph that retires stale facts and that people can also query, including from Slack. That is the product Suda publishes on suda.so.',
  },
  {
    slug: 'the-timeline-vs-memorycrow',
    route: '/compare/the-timeline-vs-memorycrow',
    name: 'MemoryCrow',
    navLabel: 'The Timeline vs MemoryCrow',
    title: 'The Timeline vs MemoryCrow',
    summary:
      'MemoryCrow is a permission-safe memory layer: Claude, ChatGPT, Cursor and MCP clients recall current, cited answers only from sources the asker can see. The Timeline is a MemoryCrow alternative only as a dated work record of decisions, promises and handoffs from chat-led work, with a daily update and human approval before lasting changes, not as a memory layer whose main job is recall inside those AI clients.',
    seoTitle: 'MemoryCrow alternatives: The Timeline vs MemoryCrow',
    seoDescription:
      'Looking for MemoryCrow alternatives? Compare The Timeline vs MemoryCrow. MemoryCrow publishes a permission-safe memory layer for Claude, ChatGPT, Cursor and MCP. The Timeline is a cited work record. Facts from memorycrow.com.',
    competitorUrl: 'https://memorycrow.com',
    facts: [
      {
        claim:
          'MemoryCrow describes itself as one team memory for every AI: connect Slack, docs, tickets and code, then ask from Claude, ChatGPT or Cursor and get the current answer with citations and permissions intact.',
        source: { href: 'https://memorycrow.com/', label: 'memorycrow.com' },
      },
      {
        claim:
          'MemoryCrow says it does not replace Slack, Notion, GitHub or Linear: those tools stay where work happens, and MemoryCrow is a memory layer beside them.',
        source: { href: 'https://memorycrow.com/faq/', label: 'memorycrow.com/faq' },
      },
      {
        claim:
          'MemoryCrow says Claude, Cursor, ChatGPT and other MCP-compatible clients can connect, and that agents can write useful facts, decisions and handoffs into memory with a selected scope.',
        source: { href: 'https://memorycrow.com/faq/', label: 'memorycrow.com/faq' },
      },
      {
        claim:
          'MemoryCrow says if it cannot prove an answer it abstains, rather than inventing a confident answer.',
        source: { href: 'https://memorycrow.com/', label: 'memorycrow.com' },
      },
      {
        claim:
          'MemoryCrow publishes plans that meter stored memory, not questions: Personal includes 150 memories a month, Team includes 500 memories a month for up to 50 members on flat workspace pricing, recall is unlimited, one-time packs start at $15 for 100 memories, and a 7-day trial is offered. Personal and Team list prices are on the pricing page.',
        source: { href: 'https://memorycrow.com/pricing/', label: 'memorycrow.com/pricing' },
      },
    ],
    timelineSide:
      'The Timeline keeps a chronology of who said what, when, with sources, from selected Slack channels, Telegram groups, forwarded email and calls. People Ask with citations, read a daily workspace update, and approve lasting record changes. Agents read the same cited record over MCP and can add notes. It is not a memory layer whose primary surface is recall inside Claude, ChatGPT or Cursor.',
    whenCompetitorBetter:
      'Choose MemoryCrow when you mainly need trusted recall inside the AI tools the team already uses, with answers scoped to the asker and abstention when proof is missing. That is the product MemoryCrow publishes on memorycrow.com.',
  },
  {
    slug: 'the-timeline-vs-achiral',
    route: '/compare/the-timeline-vs-achiral',
    name: 'Achiral',
    navLabel: 'The Timeline vs Achiral',
    title: 'The Timeline vs Achiral',
    summary:
      'Achiral publishes ACT-R-inspired emergent memory for teams of people and agents, with org-wide Chiro, personal assistants, and human confirmation before a memory becomes durable. The Timeline is an Achiral alternative only as a cited work record from Slack, Telegram, email and calls, not as an emergent-memory platform of personal assistants and Chiro.',
    seoTitle: 'Achiral alternatives: The Timeline vs Achiral',
    seoDescription:
      'Looking for Achiral alternatives? Compare The Timeline vs Achiral. Achiral publishes ACT-R-inspired emergent memory for people and agents, with Chiro and personal assistants. The Timeline is a cited work record. Facts from achiral.ai.',
    competitorUrl: 'https://achiral.ai',
    facts: [
      {
        claim:
          'Achiral describes itself as an AI memory platform for teams of people and agents. Inspired by ACT-R, a research model of how people remember and forget, memory forms from daily work, strengthens with reuse, fades when unused, and is available through chat, the API, apps and agents.',
        source: { href: 'https://achiral.ai/', label: 'achiral.ai' },
      },
      {
        claim:
          'Achiral lists connectors including Slack, Microsoft Teams, Notion, Google Workspace, Linear, Asana, GitHub, Jira, HubSpot, Salesforce, Zendesk and Intercom.',
        source: { href: 'https://achiral.ai/', label: 'achiral.ai' },
      },
      {
        claim:
          'Achiral says memories form by passive capture from everyday work, stay current with mathematical decay, and that nothing becomes a durable core memory without human confirmation. It also names MCP extensions among the ways it works with a stack.',
        source: { href: 'https://achiral.ai/', label: 'achiral.ai' },
      },
      {
        claim:
          'Achiral says every member gets a personal executive assistant and the organization gets one shared Chiro, which draft work and act on shared memory with approval.',
        source: { href: 'https://achiral.ai/pricing', label: 'achiral.ai/pricing' },
      },
      {
        claim:
          'Achiral publishes Founder free for up to 2 seats, Team from $30 per seat per month with rates that step down by tier, plus add-ons of $10 per agent per month and $19 per published app per month.',
        source: { href: 'https://achiral.ai/pricing', label: 'achiral.ai/pricing' },
      },
    ],
    timelineSide:
      'The Timeline builds a cited chronology of decisions, promises and handoffs from Slack, Telegram, email, calls and docs. People Ask with receipts and approve lasting record changes. Agents read and contribute to that same record through MCP, remember, email or webhook. It is not an emergent-memory platform of personal executive assistants plus org-wide Chiro, and it does not model memory as ACT-R decay and activation.',
    whenCompetitorBetter:
      'Choose Achiral when you want organic org memory plus collaborative assistants (shared Chiro and a personal assistant per member), a decay and activation lifecycle, and connectors across Slack, Teams, Notion, HubSpot and more. That is the product Achiral publishes on achiral.ai.',
  },
];

export function findComparePage(slug: string): ComparePageContent | undefined {
  return COMPARE_PAGES.find((page) => page.slug === slug);
}

export function findComparePageByRoute(route: string): ComparePageContent | undefined {
  return COMPARE_PAGES.find((page) => page.route === route);
}

export function isLegacyCompareSlug(slug: string): slug is LegacyCompareSlug {
  return Object.hasOwn(LEGACY_COMPARE_REDIRECTS, slug);
}
