import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type {
  IntegrationEvent,
  IntegrationProvider,
  OAuthCallbackInput,
  OAuthStartInput,
  ProviderResource,
  SyncContext,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { externalFetch as fetch } from '#src/http/external-fetch.js';
import { childLogger } from '#src/logger.js';

// Phase 11 — Linear provider.
//
// OAuth 2.0 + GraphQL. Sync surface:
//   - Issues (with state, assignee, priority, project, parent identifier)
//   - Comments
//   - Projects
//   - Webhook → Issue + Comment + Project events
//
// Issue idempotency is by lifecycle bucket; when a status bucket repeats
// (started→completed→started) the key gains `updatedAt` so the reopen is a
// new immutable raw_event. Comments and projects key by content digest so
// mutable field edits mint a revision row without pure timestamp churn.

const log = childLogger('integrations:linear');

const AUTH_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const GRAPHQL_URL = 'https://api.linear.app/graphql';

const SCOPES = ['read'];

interface LinearTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  expires_at?: number;
}

/**
 * Refresh a Linear access token. Linear access tokens default to ~1 year
 * but can be invalidated by user revoke / scope changes; refresh_token
 * grants survive those for our scopes when Linear hands one back.
 * Returns the input unchanged if no refresh_token is stored, or if the
 * current token has more than 24h of life left — refreshing more
 * frequently than that burns API quota without benefit.
 */
async function ensureAccessToken(tokens: LinearTokens): Promise<LinearTokens> {
  const env = getEnv();
  if (!env.LINEAR_CLIENT_ID || !env.LINEAR_CLIENT_SECRET) {
    return tokens;
  }
  const now = Date.now();
  // Refresh skew: 24h. Linear tokens are long-lived enough that the
  // 60s skew used by short-lived OAuth flows would never trigger.
  const SKEW_MS = 24 * 60 * 60 * 1000;
  if (tokens.expires_at && tokens.expires_at > now + SKEW_MS) return tokens;
  if (!tokens.refresh_token) {
    // No refresh token issued for this connection — leave the
    // access_token in place. The next failing API call surfaces
    // `last_error` and the operator reconnects.
    return tokens;
  }
  const body = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: env.LINEAR_CLIENT_ID,
    client_secret: env.LINEAR_CLIENT_SECRET,
  });
  const access = typeof body.access_token === 'string' ? body.access_token : '';
  if (!access) return tokens;
  const expiresIn = Number(body.expires_in ?? 365 * 24 * 3600);
  return {
    ...tokens,
    access_token: access,
    expires_in: expiresIn,
    expires_at: now + expiresIn * 1000,
    ...(typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
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
  /** Last observed lifecycle bucket per Linear issue id. */
  issue_statuses?: Record<string, string>;
}

const LINEAR_ISSUE_STATUS_CURSOR_CAP = 5_000;

function pruneIssueStatuses(
  map: Record<string, string>,
  keepIds: ReadonlySet<string>,
): Record<string, string> {
  const entries = Object.entries(map);
  if (entries.length <= LINEAR_ISSUE_STATUS_CURSOR_CAP) return map;
  const next: Record<string, string> = {};
  for (const id of keepIds) {
    const value = map[id];
    if (value) next[id] = value;
  }
  if (Object.keys(next).length < Math.min(keepIds.size, 64)) {
    for (const [id, value] of entries.slice(-Math.floor(LINEAR_ISSUE_STATUS_CURSOR_CAP / 2))) {
      next[id] = value;
    }
  }
  return next;
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

function linearIssueDedupKey(
  node: Pick<LinearIssueNode, 'id' | 'updatedAt' | 'state'>,
  opts?: { previousStatus?: string | null; forceTransition?: boolean },
): string {
  const status = linearStatus(node.state.type);
  const previousStatus = opts?.previousStatus;
  const transitioned =
    opts?.forceTransition === true ||
    (typeof previousStatus === 'string' && previousStatus !== status);
  return transitioned
    ? `linear:issue:${node.id}:${status}:${node.updatedAt}`
    : `linear:issue:${node.id}:${status}`;
}

function linearCommentBodyDigest(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function issueToEvent(
  node: LinearIssueNode,
  opts?: { previousStatus?: string | null; forceTransition?: boolean },
): IntegrationEvent {
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
    dedupKey: linearIssueDedupKey(node, opts),
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
      displayTitle: node.title,
      externalId: node.id,
      status: linearStatus(stateType),
      priority,
      url: node.url,
      aliases: [node.identifier],
      metadata: {
        linear_record_kind: 'issue',
        linear_identifier: node.identifier,
        linear_team_id: node.team.id,
        linear_team_key: node.team.key,
        linear_project_id: node.project?.id ?? null,
      },
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
  const bodyDigest = linearCommentBodyDigest(node.body);
  return {
    dedupKey: `linear:comment:${node.id}:${bodyDigest}`,
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

function linearProjectRevisionDigest(
  node: Pick<LinearProjectNode, 'name' | 'description' | 'lead' | 'startDate' | 'targetDate'>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: node.name,
        description: node.description ?? null,
        lead: node.lead?.id ?? null,
        startDate: node.startDate ?? null,
        targetDate: node.targetDate ?? null,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function projectToEvent(node: LinearProjectNode): IntegrationEvent {
  const actor: { externalId?: string; name?: string } | null = node.lead
    ? { externalId: node.lead.id, name: node.lead.name }
    : null;
  const revision = linearProjectRevisionDigest(node);
  return {
    dedupKey: `linear:project:${node.id}:${node.state}:${revision}`,
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
      metadata: {
        linear_record_kind: 'project',
        linear_state: node.state,
        linear_start_date: node.startDate ?? null,
        linear_target_date: node.targetDate ?? null,
      },
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
  issueStatuses: Record<string, string>,
): Promise<{ latest: string; issueStatuses: Record<string, string> }> {
  let latest = since ?? '';
  let statuses = { ...issueStatuses };
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
      const touched = new Set<string>();
      await ctx.writeEvents(
        nodes.map((node) => {
          const previous = statuses[node.id] ?? null;
          const event = issueToEvent(node, { previousStatus: previous });
          statuses[node.id] = linearStatus(node.state.type);
          touched.add(node.id);
          return event;
        }),
      );
      for (const n of nodes) if (n.updatedAt > latest) latest = n.updatedAt;
      statuses = pruneIssueStatuses(statuses, touched);
    },
  );
  return { latest, issueStatuses: statuses };
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
      // Capture refresh_token when Linear issues one — without this the
      // worker can't refresh after the access token lapses and the only
      // recovery path is a manual reconnect.
      ...(typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {}),
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
    // Paginate `teams`. Linear caps a single page at 100; without
    // following `pageInfo.endCursor` orgs with >100 teams would have
    // teams beyond page 1 silently dropped — and PUT /selections rejects
    // anything outside this set. Cap at 20 pages = 2000 teams (well past
    // any realistic Linear org).
    const linearTokens = tokens as LinearTokens;
    const all: { id: string; name: string; key: string }[] = [];
    let after: string | null = null;
    for (let i = 0; i < 20; i++) {
      const variables: Record<string, unknown> = { after };
      const query = `query Teams($after: String) {
        teams(first: 100, after: $after) {
          nodes { id name key }
          pageInfo { hasNextPage endCursor }
        }
      }`;
      const data = await gql<{
        teams: {
          nodes: { id: string; name: string; key: string }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(linearTokens, query, variables);
      all.push(...data.teams.nodes);
      if (!data.teams.pageInfo.hasNextPage || !data.teams.pageInfo.endCursor) break;
      after = data.teams.pageInfo.endCursor;
    }
    return all.map((t) => ({
      externalId: t.id,
      label: `${t.name} (${t.key})`,
      kind: 'linear.team',
    }));
  },

  async backfill({ tokens, selections, ctx }) {
    const teamIds = selections.filter((s) => s.kind === 'linear.team').map((s) => s.externalId);
    // Opt-in only: an integration with no linear.team selections syncs
    // nothing. Without this guard, paginate* drops the team filter when
    // teamIds is empty and pulls the entire org — inconsistent with the
    // webhook path (which drops empty-selection events).
    if (teamIds.length === 0) return;
    const input = tokens as LinearTokens;
    const linearTokens = await ensureAccessToken(input);
    if (linearTokens.access_token !== input.access_token) {
      // Refreshed in-memory; write the new ciphertext back so the next
      // sync starts from current state.
      await ctx.persistTokens(linearTokens as unknown as Record<string, unknown>);
    }
    const issues = await paginateIssues(linearTokens, null, teamIds, ctx, {});
    const latestComments = await paginateComments(linearTokens, null, teamIds, ctx);
    const latestProjects = await paginateProjects(linearTokens, null, teamIds, ctx);
    if (issues.latest) {
      await ctx.saveCursor('linear.issues', {
        updated_after: issues.latest,
        issue_statuses: issues.issueStatuses,
      });
    }
    if (latestComments) await ctx.saveCursor('linear.comments', { updated_after: latestComments });
    if (latestProjects) await ctx.saveCursor('linear.projects', { updated_after: latestProjects });
  },

  async incrementalSync({ tokens, selections, ctx }) {
    const teamIds = selections.filter((s) => s.kind === 'linear.team').map((s) => s.externalId);
    if (teamIds.length === 0) return;
    const input = tokens as LinearTokens;
    const linearTokens = await ensureAccessToken(input);
    if (linearTokens.access_token !== input.access_token) {
      await ctx.persistTokens(linearTokens as unknown as Record<string, unknown>);
    }
    const fallback = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const issuesCursor = (await ctx.loadCursor('linear.issues')) as LinearCursor;
    const commentsCursor = (await ctx.loadCursor('linear.comments')) as LinearCursor;
    const projectsCursor = (await ctx.loadCursor('linear.projects')) as LinearCursor;
    const issuesSince = issuesCursor.updated_after ?? fallback;
    const commentsSince = commentsCursor.updated_after ?? fallback;
    const projectsSince = projectsCursor.updated_after ?? fallback;
    const issues = await paginateIssues(
      linearTokens,
      issuesSince,
      teamIds,
      ctx,
      issuesCursor.issue_statuses ?? {},
    );
    const latestComments = await paginateComments(linearTokens, commentsSince, teamIds, ctx);
    const latestProjects = await paginateProjects(linearTokens, projectsSince, teamIds, ctx);
    await ctx.saveCursor('linear.issues', {
      updated_after: issues.latest || issuesSince,
      issue_statuses: issues.issueStatuses,
    });
    await ctx.saveCursor('linear.comments', { updated_after: latestComments || commentsSince });
    await ctx.saveCursor('linear.projects', { updated_after: latestProjects || projectsSince });
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ payload }) {
    const p = payload as {
      action?: string;
      type?: string;
      data?: Record<string, unknown>;
      updatedFrom?: Record<string, unknown>;
      createdAt?: string;
    };
    if (!p.data) return [];
    switch (p.type) {
      case 'Issue': {
        const node = p.data as unknown as LinearIssueNode;
        if (!node.id || !node.updatedAt) return [];
        const updatedFrom = p.updatedFrom;
        const forceTransition = Boolean(
          updatedFrom &&
          (Object.prototype.hasOwnProperty.call(updatedFrom, 'stateId') ||
            Object.prototype.hasOwnProperty.call(updatedFrom, 'state')),
        );
        return [issueToEvent(node, { forceTransition })];
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
