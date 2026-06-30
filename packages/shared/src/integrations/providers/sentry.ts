import type {
  IntegrationEvent,
  IntegrationProvider,
  ObjectMapping,
  OAuthCallbackInput,
  ProviderResource,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';

const AUTH_URL = 'https://sentry.io/oauth/authorize/';
const TOKEN_URL = 'https://sentry.io/oauth/token/';
const API_BASE = 'https://sentry.io/api/0';
const SCOPES = ['org:read', 'project:read', 'event:read', 'event:admin', 'team:read'];

interface SentryTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_at?: number;
}

interface SentryOrg {
  id?: string;
  slug: string;
  name?: string;
}

interface SentryProject {
  id?: string;
  slug: string;
  name?: string;
  platform?: string | null;
}

interface SentryIssue {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  permalink?: string;
  status?: string;
  level?: string;
  firstSeen?: string;
  lastSeen?: string;
  count?: string | number;
  userCount?: number;
  project?: { slug?: string; name?: string } | null;
  metadata?: { type?: string; value?: string; filename?: string } | null;
}

interface SentryRelease {
  version: string;
  dateCreated?: string;
  dateReleased?: string | null;
  newGroups?: number;
  url?: string;
}

interface SentryCursor {
  issues_since?: string | undefined;
  releases_since?: string | undefined;
}

function buildAuthorizeUrl(input: {
  redirectUri: string;
  state: string;
  clientId: string;
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  return url.toString();
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
  const parsed = parseJson(text) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Sentry ${String(res.status)}: ${text}`);
  return parsed;
}

async function sentryRequest(tokens: SentryTokens, pathOrUrl: string): Promise<Response> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  return fetch(url, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
}

async function sentryGetPage(
  tokens: SentryTokens,
  pathOrUrl: string,
): Promise<{ items: unknown[]; next: string | null }> {
  const res = await sentryRequest(tokens, pathOrUrl);
  const text = await res.text();
  if (!res.ok) throw new Error(`Sentry API ${String(res.status)}: ${text}`);
  return {
    items: parseJson(text) as unknown[],
    next: nextLink(res.headers.get('link')),
  };
}

async function sentryGetAll<T>(tokens: SentryTokens, path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  while (next) {
    const page = await sentryGetPage(tokens, next);
    items.push(...(page.items as T[]));
    next = page.next;
  }
  return items;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const entry of header.split(',')) {
    const urlMatch = /<([^>]+)>/.exec(entry);
    if (!urlMatch?.[1]) continue;
    const relMatch = /\brel="next"/.test(entry);
    const resultsMatch = /\bresults="true"/.test(entry);
    if (relMatch && resultsMatch) return urlMatch[1];
  }
  return null;
}

function parseJson(text: string): unknown {
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  const raw = typeof value === 'string' || typeof value === 'number' ? new Date(value) : fallback;
  return Number.isNaN(raw.getTime()) ? fallback : raw;
}

function tokenExpiry(body: Record<string, unknown>): number | null {
  const expiresIn = numberValue(body.expires_in);
  return expiresIn ? Date.now() + expiresIn * 1000 : null;
}

function tokenFromBody(body: Record<string, unknown>, previous?: SentryTokens): SentryTokens {
  const access = stringValue(body.access_token) ?? stringValue(body.token);
  if (!access) throw new Error('Sentry token exchange returned no access_token');
  const refreshToken =
    stringValue(body.refresh_token) ?? stringValue(body.refreshToken) ?? previous?.refresh_token;
  const tokenType = stringValue(body.token_type) ?? previous?.token_type;
  const scope = stringValue(body.scope) ?? previous?.scope;
  const expiresAt = tokenExpiry(body);
  return {
    access_token: access,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(tokenType ? { token_type: tokenType } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  };
}

async function refreshAccessToken(tokens: SentryTokens): Promise<SentryTokens> {
  const env = getEnv();
  if (
    !tokens.refresh_token ||
    !env.SENTRY_INTEGRATION_CLIENT_ID ||
    !env.SENTRY_INTEGRATION_CLIENT_SECRET
  ) {
    return tokens;
  }
  const body = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: env.SENTRY_INTEGRATION_CLIENT_ID,
    client_secret: env.SENTRY_INTEGRATION_CLIENT_SECRET,
  });
  return tokenFromBody(body, tokens);
}

async function ensureAccessToken(
  tokens: SentryTokens,
  ctx?: { persistTokens(tokens: Record<string, unknown>): Promise<void> },
): Promise<SentryTokens> {
  const shouldRefresh =
    Boolean(tokens.refresh_token) &&
    (!tokens.expires_at || tokens.expires_at <= Date.now() + 60_000);
  if (!shouldRefresh) return tokens;
  const refreshed = await refreshAccessToken(tokens);
  if (
    ctx &&
    (refreshed.access_token !== tokens.access_token ||
      refreshed.refresh_token !== tokens.refresh_token ||
      refreshed.expires_at !== tokens.expires_at)
  ) {
    await ctx.persistTokens(refreshed as unknown as Record<string, unknown>);
  }
  return refreshed;
}

function priorityFromLevel(level?: string): ObjectMapping['priority'] | null {
  if (level === 'fatal') return 'urgent';
  if (level === 'error') return 'high';
  if (level === 'warning') return 'medium';
  return null;
}

function statusFromIssue(status?: string): NonNullable<ObjectMapping['status']> {
  return status === 'resolved' ? 'done' : status === 'ignored' ? 'cancelled' : 'open';
}

function issueEvent(orgSlug: string, projectSlug: string, issue: SentryIssue): IntegrationEvent {
  const occurredAt = dateValue(issue.lastSeen ?? issue.firstSeen);
  const title = issue.title ?? issue.culprit ?? issue.shortId ?? `Sentry issue ${issue.id}`;
  const shortId = issue.shortId ?? issue.id;
  const priority = priorityFromLevel(issue.level);
  return {
    dedupKey: `sentry:issue:${issue.id}:${occurredAt.toISOString()}:${issue.status ?? ''}`,
    provider: 'sentry',
    externalObjectId: issue.id,
    eventType: issue.status === 'resolved' ? 'issue.resolved' : 'issue.updated',
    occurredAt,
    contentText: [
      `Sentry issue ${shortId}: ${title}`,
      issue.level ? `Level: ${issue.level}` : null,
      issue.status ? `Status: ${issue.status}` : null,
      issue.count !== undefined ? `Events: ${String(issue.count)}` : null,
      issue.userCount !== undefined ? `Users: ${String(issue.userCount)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      sentry_org_slug: orgSlug,
      sentry_project_slug: projectSlug,
      sentry_issue_id: issue.id,
      sentry_short_id: issue.shortId ?? null,
      external_url: issue.permalink ?? null,
      level: issue.level ?? null,
      status: issue.status ?? null,
      metadata: issue.metadata ?? null,
    },
    objectMap: {
      type: 'incident',
      canonicalName: `${shortId}: ${title}`,
      displayTitle: title,
      externalId: issue.id,
      status: statusFromIssue(issue.status),
      ...(priority ? { priority } : {}),
      ...(issue.permalink ? { url: issue.permalink } : {}),
      aliases: issue.shortId ? [issue.shortId] : [],
    },
  };
}

function releaseEvent(
  orgSlug: string,
  projectSlug: string,
  release: SentryRelease,
): IntegrationEvent {
  const occurredAt = dateValue(release.dateReleased ?? release.dateCreated);
  return {
    dedupKey: `sentry:release:${orgSlug}:${projectSlug}:${release.version}:${occurredAt.toISOString()}`,
    provider: 'sentry',
    externalObjectId: `${orgSlug}/${projectSlug}/release/${release.version}`,
    eventType: 'release.created',
    occurredAt,
    contentText: `Sentry release ${release.version} for ${projectSlug}`,
    extra: {
      sentry_org_slug: orgSlug,
      sentry_project_slug: projectSlug,
      release_version: release.version,
      new_groups: release.newGroups ?? null,
      external_url: release.url ?? null,
    },
    objectMap: {
      type: 'other',
      canonicalName: `Sentry release ${release.version}`,
      displayTitle: `Release ${release.version}`,
      externalId: `${orgSlug}/${projectSlug}/release/${release.version}`,
      status: 'done',
      ...(release.url ? { url: release.url } : {}),
      aliases: [release.version],
      metadata: {
        sentry_record_kind: 'release',
        sentry_org_slug: orgSlug,
        sentry_project_slug: projectSlug,
        release_version: release.version,
      },
    },
  };
}

async function syncProject(
  tokens: SentryTokens,
  orgSlug: string,
  projectSlug: string,
  cursor: SentryCursor,
): Promise<{ events: IntegrationEvent[]; cursor: SentryCursor }> {
  const query = cursor.issues_since
    ? `?query=${encodeURIComponent(`lastSeen:>${cursor.issues_since}`)}`
    : '?query=';
  const issues = await sentryGetAll<SentryIssue>(
    tokens,
    `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/${query}`,
  );
  const releases = await sentryGetAll<SentryRelease>(
    tokens,
    `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/releases/`,
  ).catch(() => []);
  const releaseEvents = releases
    .map((release) => releaseEvent(orgSlug, projectSlug, release))
    .filter(
      (event) =>
        !cursor.releases_since || event.occurredAt > dateValue(cursor.releases_since, new Date(0)),
    );
  const events = [
    ...issues.map((issue) => issueEvent(orgSlug, projectSlug, issue)),
    ...releaseEvents,
  ];
  const latestIssue = events
    .filter((event) => event.eventType.startsWith('issue.'))
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  const latestRelease = events
    .filter((event) => event.eventType === 'release.created')
    .map((event) => event.occurredAt.toISOString())
    .sort()
    .at(-1);
  return {
    events,
    cursor: {
      issues_since: latestIssue ?? cursor.issues_since,
      releases_since: latestRelease ?? cursor.releases_since,
    },
  };
}

async function selectedProjects(
  tokens: SentryTokens,
  selections: { kind: string; externalId: string }[],
): Promise<string[]> {
  const projects = selections
    .filter((selection) => selection.kind === 'sentry.project')
    .map((selection) => selection.externalId);
  for (const selection of selections.filter((item) => item.kind === 'sentry.org')) {
    const orgProjects = await sentryGetAll<SentryProject>(
      tokens,
      `/organizations/${encodeURIComponent(selection.externalId)}/projects/`,
    );
    projects.push(...orgProjects.map((project) => `${selection.externalId}/${project.slug}`));
  }
  return [...new Set(projects)];
}

export const sentryProvider: IntegrationProvider = {
  id: 'sentry',
  displayLabel: 'Sentry',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    const env = getEnv();
    if (!env.SENTRY_INTEGRATION_CLIENT_ID) {
      throw new Error('SENTRY_INTEGRATION_CLIENT_ID not configured');
    }
    return {
      authorizeUrl: buildAuthorizeUrl({
        redirectUri: input.redirectUri,
        state: input.state,
        clientId: env.SENTRY_INTEGRATION_CLIENT_ID,
      }),
    };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.SENTRY_INTEGRATION_CLIENT_ID || !env.SENTRY_INTEGRATION_CLIENT_SECRET) {
      throw new Error(
        'SENTRY_INTEGRATION_CLIENT_ID / SENTRY_INTEGRATION_CLIENT_SECRET not configured',
      );
    }
    const body = await postForm(TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: env.SENTRY_INTEGRATION_CLIENT_ID,
      client_secret: env.SENTRY_INTEGRATION_CLIENT_SECRET,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const tokens = tokenFromBody(body);
    const orgs = await sentryGetAll<SentryOrg>(tokens, '/organizations/');
    const externalAccountId =
      orgs
        .map((org) => org.slug)
        .sort()
        .join(',') || 'sentry';
    const displayName = orgs.length === 1 ? `Sentry — ${orgs[0]?.name ?? orgs[0]?.slug}` : 'Sentry';
    return {
      externalAccountId,
      displayName,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens, ctx): Promise<ProviderResource[]> {
    const sentryTokens = await ensureAccessToken(tokens as SentryTokens, ctx);
    const orgs = await sentryGetAll<SentryOrg>(sentryTokens, '/organizations/');
    const resources: ProviderResource[] = [];
    for (const org of orgs) {
      resources.push({
        externalId: org.slug,
        label: `${org.name ?? org.slug} (all projects)`,
        kind: 'sentry.org',
      });
      const projects = await sentryGetAll<SentryProject>(
        sentryTokens,
        `/organizations/${encodeURIComponent(org.slug)}/projects/`,
      );
      resources.push(
        ...projects.map((project) => ({
          externalId: `${org.slug}/${project.slug}`,
          label: `${org.slug}/${project.slug}`,
          kind: 'sentry.project',
        })),
      );
    }
    return resources;
  },

  async backfill({ tokens, selections, ctx }) {
    const sentryTokens = await ensureAccessToken(tokens as SentryTokens, ctx);
    const projects = await selectedProjects(sentryTokens, selections);
    for (const project of projects) {
      const [orgSlug, projectSlug] = project.split('/');
      if (!orgSlug || !projectSlug) continue;
      const cursor = (await ctx.loadCursor(`sentry.project:${project}`)) as SentryCursor;
      const result = await syncProject(sentryTokens, orgSlug, projectSlug, cursor);
      await ctx.writeEvents(result.events);
      await ctx.saveCursor(`sentry.project:${project}`, result.cursor);
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    await this.backfill({ integration: {} as never, tokens, selections, ctx });
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ payload }) {
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    const data = record.data && typeof record.data === 'object' ? record.data : {};
    const event = (data as Record<string, unknown>).event as Record<string, unknown> | undefined;
    const issueId =
      stringValue(event?.issue_id) ?? stringValue((data as Record<string, unknown>).issue_id);
    if (!issueId) return [];
    const occurredAt = dateValue(event?.datetime ?? (data as Record<string, unknown>).timestamp);
    const title =
      stringValue(event?.title) ?? stringValue(event?.message) ?? `Sentry issue ${issueId}`;
    const action = stringValue(record.action) ?? '';
    const actorRecord =
      record.actor && typeof record.actor === 'object'
        ? (record.actor as Record<string, unknown>)
        : null;
    const actorId = stringValue(actorRecord?.id);
    const actorName = stringValue(actorRecord?.name);
    const webUrl = stringValue(event?.web_url);
    return [
      {
        dedupKey: `sentry:webhook:${issueId}:${occurredAt.toISOString()}:${action}`,
        provider: 'sentry',
        externalObjectId: issueId,
        eventType: action === 'resolved' ? 'issue.resolved' : 'alert.triggered',
        occurredAt,
        actor: actorRecord
          ? {
              ...(actorId ? { externalId: actorId } : {}),
              ...(actorName ? { name: actorName } : {}),
            }
          : null,
        contentText: `Sentry alert: ${title}`,
        extra: { sentry_issue_id: issueId, webhook_action: action || null },
        objectMap: {
          type: 'incident',
          canonicalName: title,
          displayTitle: title,
          externalId: issueId,
          status: action === 'resolved' ? 'done' : 'open',
          ...(webUrl ? { url: webUrl } : {}),
        },
      },
    ];
  },
};
