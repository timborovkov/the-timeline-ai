import type { IntegrationProvider } from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { githubProvider } from '#src/integrations/providers/github.js';
import { googleDriveProvider } from '#src/integrations/providers/google-drive.js';
import { linearProvider } from '#src/integrations/providers/linear.js';
import { mondayProvider } from '#src/integrations/providers/monday.js';
import { sentryProvider } from '#src/integrations/providers/sentry.js';
import { slackProvider } from '#src/integrations/providers/slack.js';

// Phase 11 — Provider registry + integration catalog.
//
// Two layers:
//
//   - `_registry` maps native-provider ids to their adapter
//     implementations. The settings flow / worker resolve providers via
//     `getProvider(id)`. Only natives we actually drive sync for live
//     here.
//
//   - `CATALOG` is the marketing + UX surface. It includes the natives
//     above PLUS featured MCP-backed integrations the team can connect
//     via the custom-MCP path on `/app/team/mcp-servers`. The landing
//     page renders an `<IntegrationCloud />` over the `featured: true`
//     subset. The settings catalog grid renders `nativeOnly` entries
//     because those are the only ones with a Connect button wired to
//     the OAuth flow today.
//
// Status taxonomy:
//   - `native_available`  — adapter implemented, env credentials configured.
//   - `native_unconfigured` — adapter implemented, env credentials missing.
//   - `mcp_available`     — connectable today via the custom-MCP flow.
//   - `coming_soon`       — listed on the landing page; not yet routable.
//
// `ingestStatus` is intentionally separate from `status`: an integration can
// be queryable through MCP today while its first-party timeline ingestion
// adapter is still on the roadmap.

const _registry: Record<string, IntegrationProvider> = {
  google_drive: googleDriveProvider,
  linear: linearProvider,
  github: githubProvider,
  monday: mondayProvider,
  slack: slackProvider,
  sentry: sentryProvider,
};

export function getProvider(id: string): IntegrationProvider {
  const p = _registry[id];
  if (!p) throw new Error(`Unknown integration provider: ${id}`);
  return p;
}

export type IntegrationCategory =
  | 'dev-tools'
  | 'project-management'
  | 'productivity'
  | 'communication'
  | 'crm'
  | 'analytics'
  | 'other';

export type IntegrationKind = 'native' | 'mcp';

export type IntegrationStatus =
  | 'native_available'
  | 'native_unconfigured'
  | 'mcp_available'
  | 'coming_soon';

export type IntegrationIngestStatus = 'implemented' | 'coming_soon';

export interface CatalogEntry {
  id: string;
  label: string;
  /** Marketing description shown on cards / settings catalog. */
  description: string;
  /** SVG path relative to /public, e.g. `/connectors/github.svg`. */
  logo: string;
  category: IntegrationCategory;
  kind: IntegrationKind;
  status: IntegrationStatus;
  ingestStatus: IntegrationIngestStatus;
  /** True when shown on the landing-page integration cloud. */
  featured: boolean;
  /** Native adapters expose Connect on `/app/team/integrations`. */
  connectablePath?: '/app/team/integrations' | '/app/team/mcp-servers';
  /** MCP server URL for `mcp_available` entries. Required for one-click connect. */
  mcpUrl?: string;
  /**
   * MCP auth mode. `oauth` kicks off /api/mcp/oauth/start after creation.
   * `bearer` / `header` prompts the admin for the token. `none` for
   * public servers.
   */
  mcpAuthType?: 'none' | 'oauth' | 'bearer' | 'header';
  /** Hint shown next to the auth prompt for bearer/header mode. */
  mcpAuthHint?: string;
  /**
   * One example prompt the agent could answer once this is connected.
   * Shown under the cloud on the landing page; gives the visitor a
   * concrete reason to care.
   */
  examplePrompt: string;
}

interface CatalogSeed extends Omit<CatalogEntry, 'status'> {
  /** When set, status flips between native_available / native_unconfigured
   *  based on whether the env returns true. */
  envCheck?: () => boolean;
  /** For MCP/coming_soon entries — explicit status. */
  staticStatus?: Exclude<IntegrationStatus, 'native_available' | 'native_unconfigured'>;
}

const CATALOG_SEEDS: CatalogSeed[] = [
  // ─────────────────────── Native adapters ───────────────────────────
  {
    id: 'github',
    label: 'GitHub',
    description:
      'Native repo sync: PRs, issues, reviews, merged commits, releases, and CI runs become cited events.',
    logo: '/connectors/github.svg',
    category: 'dev-tools',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'What shipped in last week’s releases?',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET);
    },
  },
  {
    id: 'linear',
    label: 'Linear',
    description:
      'Issues, comments, status / assignee / priority changes, and projects sync as workspace objects.',
    logo: '/connectors/linear.svg',
    category: 'project-management',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'Which ENG issues did Alice complete this week?',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET);
    },
  },
  {
    id: 'google_drive',
    label: 'Google Drive',
    description:
      'Selected folders mirror into the team document drive. New files, comments, and version changes become cited timeline events.',
    logo: '/connectors/google-drive.svg',
    category: 'productivity',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'Summarize the latest version of the partnership agreement.',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    },
  },
  {
    id: 'monday',
    label: 'Monday.com',
    description:
      'Native workspace sync: boards, records, subitems, updates, column activity, and WorkDocs become cited events.',
    logo: '/connectors/monday.svg',
    category: 'project-management',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'Which launch board records changed this week?',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.MONDAY_CLIENT_ID && env.MONDAY_CLIENT_SECRET);
    },
  },
  {
    id: 'slack',
    label: 'Slack',
    description:
      'Native workspace sync: selected channels, threads, files, reactions, and edits become cited events.',
    logo: '/connectors/slack.svg',
    category: 'communication',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'What did the team decide about pricing in #leadership last week?',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
    },
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description:
      'Native issue sync: issue updates, resolved issues, and releases become cited events and incident objects.',
    logo: '/connectors/sentry.svg',
    category: 'dev-tools',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
    ingestStatus: 'implemented',
    examplePrompt: 'What broke after yesterday’s deploy?',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.SENTRY_INTEGRATION_CLIENT_ID && env.SENTRY_INTEGRATION_CLIENT_SECRET);
    },
  },

  // ─────────────────────── MCP-backed (connectable today) ────────────
  {
    id: 'notion',
    label: 'Notion',
    description:
      'Search pages, databases, and wiki content through MCP today; native page, database, comment, and revision ingestion is planned.',
    logo: '/connectors/notion.svg',
    category: 'productivity',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    mcpUrl: 'https://mcp.notion.com/mcp',
    mcpAuthType: 'oauth',
    examplePrompt: 'What’s in our incident response runbook?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'jira',
    label: 'Jira',
    description:
      'Issues, sprints, project status, and Confluence pages are queryable through Atlassian MCP today; native Jira issue, sprint, comment, and workflow ingestion is planned.',
    logo: '/connectors/jira.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    mcpUrl: 'https://mcp.atlassian.com/v1/sse',
    mcpAuthType: 'oauth',
    examplePrompt: 'How many P0 bugs are open for the mobile team?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'confluence',
    label: 'Confluence',
    description:
      'Native page, blog, comment, label, and space activity ingestion is planned; Atlassian MCP can provide live tool access meanwhile.',
    logo: '/connectors/confluence.svg',
    category: 'productivity',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    mcpUrl: 'https://mcp.atlassian.com/v1/sse',
    mcpAuthType: 'oauth',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What changed in the enterprise onboarding space?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'figma',
    label: 'Figma',
    description:
      'Recent design changes and shared file activity are queryable through MCP today; native durable design-event ingestion is planned.',
    logo: '/connectors/figma.svg',
    category: 'productivity',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    mcpUrl: 'http://127.0.0.1:3845/sse',
    mcpAuthType: 'none',
    mcpAuthHint:
      'Figma ships an MCP server inside the desktop app. Enable it in Preferences → MCP, then click Connect (no token needed).',
    examplePrompt: 'Show me the latest design iterations on the checkout flow.',
    staticStatus: 'mcp_available',
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description: 'Recent payments, refunds, subscription changes, and dispute activity.',
    logo: '/connectors/stripe.svg',
    category: 'analytics',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    mcpUrl: 'https://mcp.stripe.com',
    mcpAuthType: 'bearer',
    mcpAuthHint: 'Stripe restricted key (read-only). Generate at dashboard.stripe.com → API keys.',
    examplePrompt: 'How many subscriptions churned this month?',
    staticStatus: 'mcp_available',
  },

  // ─────────────────────── Coming soon ───────────────────────────────
  {
    id: 'hubspot',
    label: 'HubSpot',
    description:
      'Native company, contact, deal, ticket, note, and pipeline-event ingestion is planned.',
    logo: '/connectors/hubspot.svg',
    category: 'crm',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which Q3 deals slipped to Q4?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    description: 'Account history, opportunity stage changes, and contact notes.',
    logo: '/connectors/salesforce.svg',
    category: 'crm',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What did we discuss with Acme on our last call?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'attio',
    label: 'Attio',
    description:
      'Native people, company, list, note, task, and pipeline-event ingestion is planned.',
    logo: '/connectors/attio.svg',
    category: 'crm',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'List all customers we onboarded in May.',
    staticStatus: 'coming_soon',
  },
  {
    id: 'asana',
    label: 'Asana',
    description:
      'Native task, project, comment, assignee, status, and custom-field ingestion is planned.',
    logo: '/connectors/asana.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What’s blocking the launch checklist?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'trello',
    label: 'Trello',
    description: 'Native board, card, checklist, comment, and lane-move ingestion is planned.',
    logo: '/connectors/trello.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What cards moved to Done yesterday?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'basecamp',
    label: 'Basecamp',
    description:
      'Native project, message-board, to-do, schedule, document, and comment ingestion is planned.',
    logo: '/connectors/basecamp.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What changed in the client rollout project?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    description: 'Merge requests, pipelines, and releases for self-hosted teams.',
    logo: '/connectors/gitlab.svg',
    category: 'dev-tools',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which MRs are awaiting review on the infra team?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'bitbucket',
    label: 'Bitbucket',
    description:
      'Native repository, pull request, commit, pipeline, and deployment ingestion is planned.',
    logo: '/connectors/bitbucket.svg',
    category: 'dev-tools',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which Bitbucket pull requests are blocked?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'datadog',
    label: 'Datadog',
    description:
      'Native incident, monitor, alert, deployment marker, and service-event ingestion is planned.',
    logo: '/connectors/datadog.svg',
    category: 'dev-tools',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What incidents affected checkout this month?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'discord',
    label: 'Discord',
    description:
      'Native server, channel, thread, message, attachment, and voice-summary ingestion is planned.',
    logo: '/connectors/discord.svg',
    category: 'communication',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What did the community moderators decide last week?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    description:
      'Native deal, person, organization, activity, note, and pipeline-stage ingestion is planned.',
    logo: '/connectors/pipedrive.svg',
    category: 'crm',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which deals moved stages this week?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'close',
    label: 'Close',
    description: 'Native lead, opportunity, call, email, note, and task ingestion is planned.',
    logo: '/connectors/close.svg',
    category: 'crm',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which prospects need follow-up after recent calls?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'zendesk',
    label: 'Zendesk',
    description:
      'Native ticket, comment, status, priority, requester, and SLA-event ingestion is planned.',
    logo: '/connectors/zendesk.svg',
    category: 'other',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'Which support tickets mention onboarding friction?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'intercom',
    label: 'Intercom',
    description:
      'Native conversation, ticket, user, company, note, and assignment ingestion is planned.',
    logo: '/connectors/intercom.svg',
    category: 'communication',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    ingestStatus: 'coming_soon',
    examplePrompt: 'What are customers asking about billing this week?',
    staticStatus: 'coming_soon',
  },
];

function resolveStatus(seed: CatalogSeed): IntegrationStatus {
  if (seed.staticStatus) return seed.staticStatus;
  if (seed.kind === 'native') {
    // The native-availability check calls getEnv(), which throws when
    // required vars (AUTH_SECRET, DATABASE_URL) aren't set. That's the
    // case during static prerender of the landing page — the catalog
    // shouldn't fail the build just because there's no DB URL at
    // compile time. Treat any env-resolution error as "unconfigured".
    try {
      return seed.envCheck?.() ? 'native_available' : 'native_unconfigured';
    } catch {
      return 'native_unconfigured';
    }
  }
  return 'mcp_available';
}

export function listCatalog(): CatalogEntry[] {
  return CATALOG_SEEDS.map((seed) => {
    const { envCheck, staticStatus, ...rest } = seed;
    void envCheck;
    void staticStatus;
    return { ...rest, status: resolveStatus(seed) };
  });
}

export function listFeaturedCatalog(): CatalogEntry[] {
  return listCatalog().filter(
    (c) => c.featured && !(c.kind === 'native' && c.status !== 'native_available'),
  );
}

/**
 * Backwards-compatible wrapper for the settings-page catalog grid: it
 * still expects `available: boolean`. Returns only the natives because
 * those are the ones with a one-click Connect button. MCP entries land
 * in the cloud + the `/app/team/mcp-servers` flow.
 */
export interface LegacyCatalogEntry {
  id: 'google_drive' | 'linear' | 'github' | 'monday' | 'slack' | 'sentry';
  label: string;
  description: string;
  logo: string;
  available: boolean;
}

export function listAvailableProviders(): LegacyCatalogEntry[] {
  // Hide unconfigured natives entirely. The card grid is for "things
  // you can connect right now", not a teaser for what would be possible
  // if an admin set env vars. Operators who want to enable a new native
  // follow docs/setup/integrations.html and the card appears once the
  // env vars land. This trades discoverability for a cleaner UI — the
  // setup doc is linked from the page footer.
  return listCatalog()
    .filter((c) => c.kind === 'native' && c.status === 'native_available')
    .map((c) => ({
      id: c.id as LegacyCatalogEntry['id'],
      label: c.label,
      description: c.description,
      logo: c.logo,
      available: true,
    }));
}
