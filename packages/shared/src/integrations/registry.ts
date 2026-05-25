import { getEnv } from '../env.js';
import { childLogger } from '../logger.js';

import { githubProvider } from './providers/github.js';
import { googleDriveProvider } from './providers/google-drive.js';
import { linearProvider } from './providers/linear.js';

import type { IntegrationProvider } from './types.js';

const log = childLogger('integrations:registry');

// Phase 11 — Provider registry + integration catalog.
//
// Two layers:
//
//   - `_registry` maps native-provider ids to their adapter
//     implementations. The settings flow / worker resolve providers via
//     `getProvider(id)`. Only natives we actually drive sync for live
//     here (Drive, Linear, GitHub).
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

const _registry: Record<string, IntegrationProvider> = {
  google_drive: googleDriveProvider,
  linear: linearProvider,
  github: githubProvider,
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
    description: 'PRs, issues, reviews, merged commits, releases, and CI runs become cited events.',
    logo: '/connectors/github.svg',
    category: 'dev-tools',
    kind: 'native',
    featured: true,
    connectablePath: '/app/team/integrations',
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
    examplePrompt: 'Summarize the latest version of the partnership agreement.',
    envCheck: () => {
      const env = getEnv();
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    },
  },

  // ─────────────────────── MCP-backed (connectable today) ────────────
  {
    id: 'notion',
    label: 'Notion',
    description: 'Search pages, databases, and wiki content through the agent.',
    logo: '/connectors/notion.svg',
    category: 'productivity',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    mcpUrl: 'https://mcp.notion.com/mcp',
    mcpAuthType: 'oauth',
    examplePrompt: 'What’s in our incident response runbook?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Search messages, files, and channel context during a conversation.',
    logo: '/connectors/slack.svg',
    category: 'communication',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    // Slack publishes a bearer-token MCP shim; OAuth coming once their
    // first-party MCP server lands publicly.
    mcpUrl: 'https://mcp.composio.dev/slack',
    mcpAuthType: 'bearer',
    mcpAuthHint: 'Composio Slack MCP token — generate at https://app.composio.dev',
    examplePrompt: 'What did the team decide about pricing in #leadership last week?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'jira',
    label: 'Atlassian (Jira + Confluence)',
    description: 'Issues, sprints, project status, and Confluence pages in one connector.',
    logo: '/connectors/jira.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    mcpUrl: 'https://mcp.atlassian.com/v1/sse',
    mcpAuthType: 'oauth',
    examplePrompt: 'How many P0 bugs are open for the mobile team?',
    staticStatus: 'mcp_available',
  },
  {
    id: 'figma',
    label: 'Figma',
    description: 'Recent design changes and shared file activity become timeline events.',
    logo: '/connectors/figma.svg',
    category: 'productivity',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    mcpUrl: 'http://127.0.0.1:3845/sse',
    mcpAuthType: 'none',
    mcpAuthHint:
      'Figma ships an MCP server inside the desktop app. Enable it in Preferences → MCP, then click Connect (no token needed).',
    examplePrompt: 'Show me the latest design iterations on the checkout flow.',
    staticStatus: 'mcp_available',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Errors, regressions, and release health visible from chat.',
    logo: '/connectors/sentry.svg',
    category: 'dev-tools',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
    mcpUrl: 'https://mcp.sentry.dev/sse',
    mcpAuthType: 'oauth',
    examplePrompt: 'What broke after yesterday’s deploy?',
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
    description: 'Deals, contacts, and pipeline activity — connect via MCP when published.',
    logo: '/connectors/hubspot.svg',
    category: 'crm',
    kind: 'mcp',
    featured: true,
    connectablePath: '/app/team/mcp-servers',
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
    examplePrompt: 'What did we discuss with Acme on our last call?',
    staticStatus: 'coming_soon',
  },
  {
    id: 'attio',
    label: 'Attio',
    description: 'Pipeline activity and people data — modern CRM, MCP-backed.',
    logo: '/connectors/attio.svg',
    category: 'crm',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    examplePrompt: 'List all customers we onboarded in May.',
    staticStatus: 'coming_soon',
  },
  {
    id: 'asana',
    label: 'Asana',
    description: 'Task status, comments, and project rollups.',
    logo: '/connectors/asana.svg',
    category: 'project-management',
    kind: 'mcp',
    featured: false,
    connectablePath: '/app/team/mcp-servers',
    examplePrompt: 'What’s blocking the launch checklist?',
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
    examplePrompt: 'Which MRs are awaiting review on the infra team?',
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
    //
    // We log at warn level (debug-equivalent for build time, but visible
    // at runtime). A "real" env misconfiguration in production will
    // surface here as a worker / web log line instead of vanishing
    // silently and rendering the provider as Not configured.
    try {
      return seed.envCheck?.() ? 'native_available' : 'native_unconfigured';
    } catch (err) {
      log.warn({ err, provider: seed.id }, 'env check threw — treating as unconfigured');
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
  return listCatalog().filter((c) => c.featured);
}

/**
 * Backwards-compatible wrapper for the settings-page catalog grid: it
 * still expects `available: boolean`. Returns only the natives because
 * those are the ones with a one-click Connect button. MCP entries land
 * in the cloud + the `/app/team/mcp-servers` flow.
 */
export interface LegacyCatalogEntry {
  id: 'google_drive' | 'linear' | 'github';
  label: string;
  description: string;
  logo: string;
  available: boolean;
}

export function listAvailableProviders(): LegacyCatalogEntry[] {
  return listCatalog()
    .filter((c) => c.kind === 'native')
    .map((c) => ({
      id: c.id as 'google_drive' | 'linear' | 'github',
      label: c.label,
      description: c.description,
      logo: c.logo,
      available: c.status === 'native_available',
    }));
}
