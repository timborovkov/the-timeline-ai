export const COMPARE_HUB_ROUTE = '/compare' as const;

export const COMPARE_SLUGS = [
  'the-timeline-vs-day-ai',
  'the-timeline-vs-folk',
  'the-timeline-vs-glean',
  'the-timeline-vs-geekbot',
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
    "Looking for Day AI, Folk, Glean or Geekbot alternatives? Head-to-head pages cite each competitor's own site. Unverified claims are left out. How existing tools plug in lives under Integrations.",
  seoTitle: 'Compare The Timeline',
  seoDescription:
    "Looking for Day AI, Folk, Glean or Geekbot alternatives? Compare each with The Timeline. Every competitor fact cites that company's own site.",
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
