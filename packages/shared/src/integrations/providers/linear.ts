import { createHmac, timingSafeEqual } from 'node:crypto';

import { getEnv } from '../../env.js';
import { childLogger } from '../../logger.js';

import type {
  IntegrationEvent,
  IntegrationProvider,
  OAuthCallbackInput,
  OAuthStartInput,
  ProviderResource,
  SyncContext,
} from '../types.js';

// Phase 11 — Linear provider.
//
// OAuth 2.0 + GraphQL. Sync surface:
//   - Issues (with state, assignee, priority, project, parent identifier)
//   - Comments
//   - Projects
//   - Webhook → Issue + Comment + Project events
//
// Idempotency is by dedupKey = `linear:<kind>:<id>:<updatedAt>`. A status or
// assignee change updates `updatedAt`, so the next sync emits a fresh event.

const log = childLogger('integrations:linear');

const AUTH_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const GRAPHQL_URL = 'https://api.linear.app/graphql';

const SCOPES = ['read'];

interface LinearTokens {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  expires_at?: number;
}

async function postForm(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(
      `Linear ${String(res.status)}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
    );
  }
  return parsed as Record<string, unknown>;
}

async function gql<T>(
  tokens: LinearTokens,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Linear GraphQL ${String(res.status)}: ${text}`);
  }
  const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  if (!json.data) throw new Error('Linear GraphQL returned no data');
  return json.data;
}

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  updatedAt: string;
  priority?: number | null;
  priorityLabel?: string | null;
  state: { id: string; name: string; type: string };
  assignee?: { id: string; name: string; email?: string | null } | null;
  team: { id: string; key: string; name: string };
  project?: { id: string; name: string } | null;
  parent?: { id: string; identifier: string } | null;
}

interface LinearCommentNode {
  id: string;
  body: string;
  url: string;
  updatedAt: string;
  user?: { id: string; name: string; email?: string | null } | null;
  issue: { id: string; identifier: string; title: string };
}

interface LinearProjectNode {
  id: string;
  name: string;
  description?: string | null;
  url: string;
  updatedAt: string;
  state: string;
  targetDate?: string | null;
  startDate?: string | null;
  lead?: { id: string; name: string } | null;
}

interface LinearCursor {
  updated_after?: string;
}

const ISSUE_FIELDS = `
  id identifier title description url updatedAt priority priorityLabel
  state { id name type }
  assignee { id name email }
  team { id key name }
  project { id name }
  parent { id identifier }
`;

const COMMENT_FIELDS = `
  id body url updatedAt
  user { id name email }
  issue { id identifier title }
`;

const PROJECT_FIELDS = `
  id name description url updatedAt state targetDate startDate
  lead { id name }
`;

async function paginate<T>(
  tokens: LinearTokens,
  build: (after: string | null) => { query: string; variables: Record<string, unknown> },
  read: (data: unknown) => {
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  },
  onPage: (nodes: T[]) => Promise<void>,
  cap = 50,
): Promise<void> {
  let after: string | null = null;
  for (let i = 0; i < cap; i++) {
    const built = build(after);
    const data = await gql<unknown>(tokens, built.query, built.variables);
    const page = read(data);
    if (page.nodes.length > 0) await onPage(page.nodes);
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return;
    after = page.pageInfo.endCursor;
  }
  log.warn('paginate cap hit');
}

function linearPriorityLabel(
  n: number | null | undefined,
): 'low' | 'medium' | 'high' | 'urgent' | null {
  // Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  switch (n) {
    case 1:
      return 'urgent';
    case 2:
      return 'high';
    case 3:
      return 'medium';
    case 4:
      return 'low';
    default:
      return null;
  }
}

function linearStatus(stateType: string): 'open' | 'in_progress' | 'done' | 'cancelled' {
  switch (stateType) {
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'canceled':
      return 'cancelled';
    default:
      return 'open';
  }
}

function issueToEvent(node: LinearIssueNode): IntegrationEvent {
  const actor: { externalId?: string; name?: string; email?: string } | null = node.assignee
    ? {
        externalId: node.assignee.id,
        name: node.assignee.name,
        ...(node.assignee.email ? { email: node.assignee.email } : {}),
      }
    : null;
  const stateType = node.state.type;
  let eventType = 'issue.updated';
  if (stateType === 'completed' || stateType === 'canceled') eventType = `issue.${stateType}`;
  const priority = linearPriorityLabel(node.priority);
  return {
    dedupKey: `linear:issue:${node.id}:${node.updatedAt}`,
    provider: 'linear',
    externalObjectId: node.id,
    externalEventId: node.updatedAt,
    eventType,
    occurredAt: new Date(node.updatedAt),
    actor,
    contentText: `Linear ${node.identifier}: ${node.title}${node.description ? `\n\n${node.description}` : ''}`,
    extra: {
      linear: {
        kind: 'issue',
        identifier: node.identifier,
        url: node.url,
        state: { name: node.state.name, type: node.state.type, id: node.state.id },
        priority: node.priority ?? null,
        priority_label: node.priorityLabel ?? null,
        team: { key: node.team.key, name: node.team.name, id: node.team.id },
        project: node.project ?? null,
        parent: node.parent ?? null,
      },
    },
    objectMap: {
      type: 'task',
      canonicalName: `${node.identifier}: ${node.title}`,
      externalId: node.id,
      status: linearStatus(stateType),
      priority,
      url: node.url,
      aliases: [node.identifier],
    },
  };
}

function commentToEvent(node: LinearCommentNode): IntegrationEvent {
  const actor: { externalId?: string; name?: string; email?: string } | null = node.user
    ? {
        externalId: node.user.id,
        name: node.user.name,
        ...(node.user.email ? { email: node.user.email } : {}),
      }
    : null;
  return {
    dedupKey: `linear:comment:${node.id}:${node.updatedAt}`,
    provider: 'linear',
    externalObjectId: `${node.issue.id}#comment:${node.id}`,
    externalEventId: node.updatedAt,
    eventType: 'comment.updated',
    occurredAt: new Date(node.updatedAt),
    actor,
    contentText: `Linear ${node.issue.identifier} comment: ${node.body}`,
    extra: {
      linear: {
        kind: 'comment',
        url: node.url,
        issue: node.issue,
      },
    },
  };
}

function projectToEvent(node: LinearProjectNode): IntegrationEvent {
  const actor: { externalId?: string; name?: string } | null = node.lead
    ? { externalId: node.lead.id, name: node.lead.name }
    : null;
  return {
    dedupKey: `linear:project:${node.id}:${node.updatedAt}`,
    provider: 'linear',
    externalObjectId: node.id,
    externalEventId: node.updatedAt,
    eventType: `project.${node.state}`,
    occurredAt: new Date(node.updatedAt),
    actor,
    contentText: `Linear project "${node.name}"${node.description ? `\n\n${node.description}` : ''}`,
    extra: {
      linear: {
        kind: 'project',
        url: node.url,
        state: node.state,
        start_date: node.startDate ?? null,
        target_date: node.targetDate ?? null,
      },
    },
    objectMap: {
      type: 'project',
      canonicalName: node.name,
      externalId: node.id,
      status:
        node.state === 'completed' ? 'done' : node.state === 'canceled' ? 'cancelled' : 'open',
      url: node.url,
    },
  };
}

function buildAuthorizeUrl(input: OAuthStartInput): string {
  const env = getEnv();
  if (!env.LINEAR_CLIENT_ID) throw new Error('LINEAR_CLIENT_ID not configured');
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.LINEAR_CLIENT_ID);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', input.state);
  url.searchParams.set('actor', 'application');
  return url.toString();
}

async function paginateIssues(
  tokens: LinearTokens,
  since: string | null,
  teamIds: string[],
  ctx: SyncContext,
): Promise<string> {
  let latest = since ?? '';
  const filterClauses: string[] = [];
  if (since) filterClauses.push('updatedAt: { gt: $since }');
  if (teamIds.length > 0) filterClauses.push('team: { id: { in: $teamIds } }');
  const filter = filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} },` : '';
  const argSig = ['$after: String'];
  if (since) argSig.push('$since: DateTimeOrDuration!');
  if (teamIds.length > 0) argSig.push('$teamIds: [ID!]!');
  const query = `query Issues(${argSig.join(', ')}) {
    issues(first: 50, after: $after, ${filter} orderBy: updatedAt) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  await paginate<LinearIssueNode>(
    tokens,
    (after) => {
      const v: Record<string, unknown> = { after };
      if (since) v.since = since;
      if (teamIds.length > 0) v.teamIds = teamIds;
      return { query, variables: v };
    },
    (data) =>
      (
        data as {
          issues: {
            nodes: LinearIssueNode[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        }
      ).issues,
    async (nodes) => {
      await ctx.writeEvents(nodes.map(issueToEvent));
      for (const n of nodes) if (n.updatedAt > latest) latest = n.updatedAt;
    },
  );
  return latest;
}

async function paginateComments(
  tokens: LinearTokens,
  since: string | null,
  teamIds: string[],
  ctx: SyncContext,
): Promise<string> {
  let latest = since ?? '';
  const filterClauses: string[] = [];
  if (since) filterClauses.push('updatedAt: { gt: $since }');
  if (teamIds.length > 0) filterClauses.push('issue: { team: { id: { in: $teamIds } } }');
  const filter = filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} },` : '';
  const argSig = ['$after: String'];
  if (since) argSig.push('$since: DateTimeOrDuration!');
  if (teamIds.length > 0) argSig.push('$teamIds: [ID!]!');
  const query = `query Comments(${argSig.join(', ')}) {
    comments(first: 50, after: $after, ${filter} orderBy: updatedAt) {
      nodes { ${COMMENT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  await paginate<LinearCommentNode>(
    tokens,
    (after) => {
      const v: Record<string, unknown> = { after };
      if (since) v.since = since;
      if (teamIds.length > 0) v.teamIds = teamIds;
      return { query, variables: v };
    },
    (data) =>
      (
        data as {
          comments: {
            nodes: LinearCommentNode[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        }
      ).comments,
    async (nodes) => {
      await ctx.writeEvents(nodes.map(commentToEvent));
      for (const n of nodes) if (n.updatedAt > latest) latest = n.updatedAt;
    },
  );
  return latest;
}

async function paginateProjects(
  tokens: LinearTokens,
  since: string | null,
  teamIds: string[],
  ctx: SyncContext,
): Promise<string> {
  let latest = since ?? '';
  const filterClauses: string[] = [];
  if (since) filterClauses.push('updatedAt: { gt: $since }');
  if (teamIds.length > 0) filterClauses.push('accessibleTeams: { id: { in: $teamIds } }');
  const filter = filterClauses.length > 0 ? `filter: { ${filterClauses.join(', ')} },` : '';
  const argSig = ['$after: String'];
  if (since) argSig.push('$since: DateTimeOrDuration!');
  if (teamIds.length > 0) argSig.push('$teamIds: [ID!]!');
  const query = `query Projects(${argSig.join(', ')}) {
    projects(first: 50, after: $after, ${filter} orderBy: updatedAt) {
      nodes { ${PROJECT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  await paginate<LinearProjectNode>(
    tokens,
    (after) => {
      const v: Record<string, unknown> = { after };
      if (since) v.since = since;
      if (teamIds.length > 0) v.teamIds = teamIds;
      return { query, variables: v };
    },
    (data) =>
      (
        data as {
          projects: {
            nodes: LinearProjectNode[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        }
      ).projects,
    async (nodes) => {
      await ctx.writeEvents(nodes.map(projectToEvent));
      for (const n of nodes) if (n.updatedAt > latest) latest = n.updatedAt;
    },
  );
  return latest;
}

export function verifyLinearSignature(body: string, signature: string | null): boolean {
  const env = getEnv();
  if (!env.LINEAR_WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac('sha256', env.LINEAR_WEBHOOK_SECRET).update(body).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}

export const linearProvider: IntegrationProvider = {
  id: 'linear',
  displayLabel: 'Linear',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    return { authorizeUrl: buildAuthorizeUrl(input) };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
      throw new Error('LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET not configured');
    }
    const body = await postForm(TOKEN_URL, {
      grant_type: 'authorization_code',
      code: input.code,
      client_id: env.LINEAR_CLIENT_ID,
      client_secret: env.LINEAR_CLIENT_SECRET,
      redirect_uri: input.redirectUri,
    });
    const access = typeof body.access_token === 'string' ? body.access_token : '';
    if (!access) throw new Error('Linear token exchange returned no access_token');
    const expiresIn = Number(body.expires_in ?? 365 * 24 * 3600);
    const tokens: LinearTokens = {
      access_token: access,
      token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      expires_in: expiresIn,
      expires_at: Date.now() + expiresIn * 1000,
      scope: typeof body.scope === 'string' ? body.scope : SCOPES.join(','),
    };
    // externalAccountId MUST be the stable Linear org id so reconnects
    // upsert on the existing integration row. A random fallback would
    // silently produce duplicate integrations every reconnect — fail
    // the OAuth flow instead and let the user retry.
    let orgName: string;
    let orgId: string;
    try {
      const data = await gql<{
        viewer: { organization: { id: string; name: string }; email: string };
      }>(tokens, `query { viewer { organization { id name } email } }`);
      orgName = `Linear — ${data.viewer.organization.name}`;
      orgId = data.viewer.organization.id;
    } catch (err) {
      log.warn({ err }, 'failed to fetch linear viewer');
      throw new Error(
        'linear_viewer_lookup_failed: could not resolve the authenticated org id from viewer — reconnect and try again',
      );
    }
    return {
      externalAccountId: orgId,
      displayName: orgName,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
      accessTokenExpiresAt: new Date(tokens.expires_at ?? Date.now() + expiresIn * 1000),
    };
  },

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    const data = await gql<{ teams: { nodes: { id: string; name: string; key: string }[] } }>(
      tokens as LinearTokens,
      `query { teams(first: 100) { nodes { id name key } } }`,
    );
    return data.teams.nodes.map((t) => ({
      externalId: t.id,
      label: `${t.name} (${t.key})`,
      kind: 'linear.team',
    }));
  },

  async backfill({ tokens, selections, ctx }) {
    const teamIds = selections.filter((s) => s.kind === 'linear.team').map((s) => s.externalId);
    const linearTokens = tokens as LinearTokens;
    const latestIssues = await paginateIssues(linearTokens, null, teamIds, ctx);
    const latestComments = await paginateComments(linearTokens, null, teamIds, ctx);
    const latestProjects = await paginateProjects(linearTokens, null, teamIds, ctx);
    if (latestIssues) await ctx.saveCursor('linear.issues', { updated_after: latestIssues });
    if (latestComments) await ctx.saveCursor('linear.comments', { updated_after: latestComments });
    if (latestProjects) await ctx.saveCursor('linear.projects', { updated_after: latestProjects });
  },

  async incrementalSync({ tokens, selections, ctx }) {
    const teamIds = selections.filter((s) => s.kind === 'linear.team').map((s) => s.externalId);
    const linearTokens = tokens as LinearTokens;
    const fallback = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const issuesCursor = (await ctx.loadCursor('linear.issues')) as LinearCursor;
    const commentsCursor = (await ctx.loadCursor('linear.comments')) as LinearCursor;
    const projectsCursor = (await ctx.loadCursor('linear.projects')) as LinearCursor;
    const issuesSince = issuesCursor.updated_after ?? fallback;
    const commentsSince = commentsCursor.updated_after ?? fallback;
    const projectsSince = projectsCursor.updated_after ?? fallback;
    const latestIssues = await paginateIssues(linearTokens, issuesSince, teamIds, ctx);
    const latestComments = await paginateComments(linearTokens, commentsSince, teamIds, ctx);
    const latestProjects = await paginateProjects(linearTokens, projectsSince, teamIds, ctx);
    await ctx.saveCursor('linear.issues', { updated_after: latestIssues || issuesSince });
    await ctx.saveCursor('linear.comments', { updated_after: latestComments || commentsSince });
    await ctx.saveCursor('linear.projects', { updated_after: latestProjects || projectsSince });
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ payload }) {
    const p = payload as {
      action?: string;
      type?: string;
      data?: Record<string, unknown>;
      createdAt?: string;
    };
    if (!p.data) return [];
    switch (p.type) {
      case 'Issue': {
        const node = p.data as unknown as LinearIssueNode;
        if (!node.id || !node.updatedAt) return [];
        return [issueToEvent(node)];
      }
      case 'Comment': {
        const node = p.data as unknown as LinearCommentNode;
        if (!node.id || !node.updatedAt) return [];
        return [commentToEvent(node)];
      }
      case 'Project': {
        const node = p.data as unknown as LinearProjectNode;
        if (!node.id || !node.updatedAt) return [];
        return [projectToEvent(node)];
      }
      default:
        return [];
    }
  },
};
