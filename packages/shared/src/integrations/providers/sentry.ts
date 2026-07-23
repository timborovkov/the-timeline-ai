import type {
  IntegrationEvent,
  IntegrationProvider,
  ObjectMapping,
  OAuthCallbackInput,
  ProviderResource,
  TargetedSyncTask,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { externalFetch as fetch } from '#src/http/external-fetch.js';

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
  dateAdded?: string | null;
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
  return fetch(
    url,
    {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    },
    { retries: 1 },
  );
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedRecord(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return recordValue(record?.[key]);
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
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

function statusFromWebhookIssue(
  action: string,
  status?: string,
): NonNullable<ObjectMapping['status']> {
  if (action === 'resolved') return 'done';
  if (action === 'ignored') return 'cancelled';
  return statusFromIssue(status);
}

function issueWebhookEventType(action: string, status?: string): string {
  if (action === 'created') return 'issue.created';
  if (action === 'resolved') return 'issue.resolved';
  if (action === 'ignored') return 'issue.ignored';
  if (action === 'assigned') return 'issue.assigned';
  if (action === 'unresolved') return 'issue.unresolved';
  if (status === 'resolved') return 'issue.resolved';
  return 'issue.updated';
}

function issuePermalink(issue: SentryIssue): string | null {
  return stringValue(issue.permalink);
}

function actorFromRecord(
  record: Record<string, unknown> | null,
): { externalId?: string; name?: string; email?: string } | null {
  if (!record) return null;
  const externalId = stringValue(record.id);
  const name = stringValue(record.name);
  const email = stringValue(record.email);
  if (!externalId && !name && !email) return null;
  return {
    ...(externalId ? { externalId } : {}),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

function issueEvent(orgSlug: string, projectSlug: string, issue: SentryIssue): IntegrationEvent {
  const occurredAt = dateValue(issue.lastSeen ?? issue.firstSeen);
  const title = issue.title ?? issue.culprit ?? issue.shortId ?? `Sentry issue ${issue.id}`;
  const shortId = issue.shortId ?? issue.id;
  const priority = priorityFromLevel(issue.level);
  const permalink = issuePermalink(issue);
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
      external_url: permalink,
      level: issue.level ?? null,
      status: issue.status ?? null,
      count: issue.count ?? null,
      user_count: issue.userCount ?? null,
      metadata: issue.metadata ?? null,
    },
    objectMap: {
      type: 'incident',
      canonicalName: `${shortId}: ${title}`,
      displayTitle: title,
      externalId: issue.id,
      status: statusFromIssue(issue.status),
      ...(priority ? { priority } : {}),
      ...(permalink ? { url: permalink } : {}),
      aliases: issue.shortId ? [issue.shortId] : [],
      metadata: {
        sentry_org_slug: orgSlug,
        sentry_project_slug: projectSlug,
        sentry_issue_id: issue.id,
        sentry_short_id: issue.shortId ?? null,
        level: issue.level ?? null,
        status: issue.status ?? null,
        count: issue.count ?? null,
        user_count: issue.userCount ?? null,
        metadata: issue.metadata ?? null,
      },
    },
  };
}

function issueWebhookEvent(input: {
  orgSlug: string | null;
  projectSlug: string | null;
  issue: SentryIssue;
  action: string;
  actor: Record<string, unknown> | null;
}): IntegrationEvent {
  const occurredAt = dateValue(input.issue.lastSeen ?? input.issue.firstSeen);
  const title =
    input.issue.title ??
    input.issue.culprit ??
    input.issue.shortId ??
    `Sentry issue ${input.issue.id}`;
  const shortId = input.issue.shortId ?? input.issue.id;
  const priority = priorityFromLevel(input.issue.level);
  const permalink = issuePermalink(input.issue);
  const eventType = issueWebhookEventType(input.action, input.issue.status);
  return {
    dedupKey: `sentry:webhook:${input.issue.id}:${occurredAt.toISOString()}:${input.action}`,
    provider: 'sentry',
    externalObjectId: input.issue.id,
    eventType,
    occurredAt,
    actor: actorFromRecord(input.actor),
    contentText: [
      `Sentry issue ${input.action || 'updated'}: ${shortId}: ${title}`,
      input.issue.level ? `Level: ${input.issue.level}` : null,
      input.issue.status ? `Status: ${input.issue.status}` : null,
      input.issue.count !== undefined ? `Events: ${String(input.issue.count)}` : null,
      input.issue.userCount !== undefined ? `Users: ${String(input.issue.userCount)}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    extra: {
      sentry_org_slug: input.orgSlug,
      sentry_project_slug: input.projectSlug,
      sentry_issue_id: input.issue.id,
      sentry_short_id: input.issue.shortId ?? null,
      webhook_action: input.action || null,
      external_url: permalink,
      level: input.issue.level ?? null,
      status: input.issue.status ?? null,
      count: input.issue.count ?? null,
      user_count: input.issue.userCount ?? null,
      metadata: input.issue.metadata ?? null,
    },
    objectMap: {
      type: 'incident',
      canonicalName: `${shortId}: ${title}`,
      displayTitle: title,
      externalId: input.issue.id,
      status: statusFromWebhookIssue(input.action, input.issue.status),
      ...(priority ? { priority } : {}),
      ...(permalink ? { url: permalink } : {}),
      aliases: input.issue.shortId ? [input.issue.shortId] : [],
      metadata: {
        sentry_org_slug: input.orgSlug,
        sentry_project_slug: input.projectSlug,
        sentry_issue_id: input.issue.id,
        sentry_short_id: input.issue.shortId ?? null,
        webhook_action: input.action || null,
        level: input.issue.level ?? null,
        status: input.issue.status ?? null,
        count: input.issue.count ?? null,
        user_count: input.issue.userCount ?? null,
        metadata: input.issue.metadata ?? null,
      },
    },
  };
}

function releaseEvent(
  orgSlug: string,
  projectSlug: string,
  release: SentryRelease,
  action = 'created',
): IntegrationEvent {
  const occurredAt = dateValue(release.dateReleased ?? release.dateCreated ?? release.dateAdded);
  return {
    dedupKey: `sentry:release:${orgSlug}:${projectSlug}:${release.version}:${occurredAt.toISOString()}:${action}`,
    provider: 'sentry',
    externalObjectId: `${orgSlug}/${projectSlug}/release/${release.version}`,
    eventType: action === 'deployed' ? 'release.deployed' : 'release.created',
    occurredAt,
    contentText: `Sentry release ${release.version} for ${projectSlug}`,
    extra: {
      sentry_org_slug: orgSlug,
      sentry_project_slug: projectSlug,
      release_version: release.version,
      webhook_action: action,
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

function sentryOrgSlugFromUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const pathMatch = /\/organizations\/([^/]+)\//.exec(url.pathname);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    if (url.hostname.endsWith('.sentry.io')) {
      const [subdomain] = url.hostname.split('.');
      if (subdomain && subdomain !== 'sentry') return subdomain;
    }
  } catch {
    return null;
  }
  return null;
}

function sentryProjectSlugFromUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    const projectMatch = /\/projects\/[^/]+\/([^/]+)\//.exec(url.pathname);
    if (projectMatch?.[1]) return decodeURIComponent(projectMatch[1]);
  } catch {
    return null;
  }
  return null;
}

function sentryIssueFromRecord(issue: Record<string, unknown> | null): SentryIssue | null {
  if (!issue) return null;
  const id = firstString([issue.id, issue.issue_id]);
  if (!id) return null;
  const project = recordValue(issue.project);
  const metadata = recordValue(issue.metadata);
  const shortId = firstString([issue.shortId, issue.short_id]);
  const title = firstString([issue.title, issue.culprit, issue.message]);
  const culprit = stringValue(issue.culprit);
  const permalink = firstString([issue.permalink, issue.web_url, issue.url]);
  const status = stringValue(issue.status);
  const level = stringValue(issue.level);
  const firstSeen = firstString([issue.firstSeen, issue.first_seen]);
  const lastSeen = firstString([issue.lastSeen, issue.last_seen, issue.datetime]);
  const userCount = numberValue(issue.userCount ?? issue.user_count);
  const projectSlug = stringValue(project?.slug);
  return {
    id,
    ...(shortId ? { shortId } : {}),
    ...(title ? { title } : {}),
    ...(culprit ? { culprit } : {}),
    ...(permalink ? { permalink } : {}),
    ...(status ? { status } : {}),
    ...(level ? { level } : {}),
    ...(firstSeen ? { firstSeen } : {}),
    ...(lastSeen ? { lastSeen } : {}),
    ...(issue.count !== undefined ? { count: issue.count as string | number } : {}),
    ...(userCount !== null ? { userCount } : {}),
    ...(projectSlug ? { project: { slug: projectSlug } } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function sentryReleaseFromRecord(release: Record<string, unknown> | null): SentryRelease | null {
  if (!release) return null;
  const version = firstString([release.version, release.shortVersion, release.short_version]);
  if (!version) return null;
  const dateCreated = firstString([release.dateCreated, release.date_created]);
  const dateReleased = firstString([release.dateReleased, release.date_released]);
  const dateAdded = firstString([release.dateAdded, release.date_added]);
  const newGroups = numberValue(release.newGroups ?? release.new_groups);
  const url = stringValue(release.url);
  return {
    version,
    ...(dateCreated ? { dateCreated } : {}),
    ...(dateReleased ? { dateReleased } : {}),
    ...(dateAdded ? { dateAdded } : {}),
    ...(newGroups !== null ? { newGroups } : {}),
    ...(url ? { url } : {}),
  };
}

function releaseProjectSlug(release: Record<string, unknown> | null): string | null {
  const project = nestedRecord(release, 'project');
  const projects = release?.projects;
  if (Array.isArray(projects)) {
    for (const item of projects) {
      const itemRecord = recordValue(item);
      const slug = itemRecord
        ? (stringValue(itemRecord.slug) ?? stringValue(itemRecord.name))
        : null;
      if (slug) return slug;
      const text = stringValue(item);
      if (text) return text;
    }
  }
  return firstString([project?.slug, project?.name, sentryProjectSlugFromUrl(release?.url)]);
}

function sentryWebhookProject(payload: unknown): string | null {
  const record = recordValue(payload);
  if (!record) return null;
  const dataRecord = nestedRecord(record, 'data') ?? {};
  const event = nestedRecord(dataRecord, 'event');
  const issue = nestedRecord(dataRecord, 'issue');
  const release = nestedRecord(dataRecord, 'release');
  const issueProject = nestedRecord(issue, 'project');
  const project = nestedRecord(record, 'project') ?? nestedRecord(dataRecord, 'project');
  const organization =
    nestedRecord(record, 'organization') ?? nestedRecord(dataRecord, 'organization');
  const orgSlug = firstString([
    organization?.slug,
    sentryOrgSlugFromUrl(dataRecord.web_url),
    sentryOrgSlugFromUrl(event?.web_url),
    sentryOrgSlugFromUrl(event?.issue_url),
    sentryOrgSlugFromUrl(issue?.permalink),
    sentryOrgSlugFromUrl(issue?.web_url),
    sentryOrgSlugFromUrl(issue?.url),
    sentryOrgSlugFromUrl(release?.url),
  ]);
  const projectSlug = firstString([
    project?.slug,
    event?.project_slug,
    typeof event?.project === 'string' ? event.project : null,
    issueProject?.slug,
    sentryProjectSlugFromUrl(issue?.permalink),
    sentryProjectSlugFromUrl(issue?.web_url),
    releaseProjectSlug(release),
  ]);
  return orgSlug && projectSlug ? `${orgSlug}/${projectSlug}` : null;
}

function sentryWebhookOrgProject(payload: unknown): {
  orgSlug: string | null;
  projectSlug: string | null;
} {
  const project = sentryWebhookProject(payload);
  if (!project) return { orgSlug: null, projectSlug: null };
  const [orgSlug, projectSlug] = project.split('/');
  return { orgSlug: orgSlug ?? null, projectSlug: projectSlug ?? null };
}

function projectSyncTask(input: {
  integrationId: string;
  teamId: string;
  project: string | null;
}): TargetedSyncTask[] {
  return input.project
    ? [
        {
          integrationId: input.integrationId,
          teamId: input.teamId,
          triggeredBy: 'webhook' as const,
          resourceType: 'sentry.project',
          externalId: input.project,
          reason: 'sentry_project_webhook',
        },
      ]
    : [];
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
  async handleWebhook({ integration, payload }) {
    const record = recordValue(payload);
    if (!record) return [];
    const data = nestedRecord(record, 'data') ?? {};
    const event = nestedRecord(data, 'event');
    const action = stringValue(record.action) ?? '';
    const actor = recordValue(record.actor);
    const project = sentryWebhookProject(payload);
    const orgProject = sentryWebhookOrgProject(payload);
    const issue = sentryIssueFromRecord(nestedRecord(data, 'issue'));
    if (issue) {
      return {
        events: [
          issueWebhookEvent({
            orgSlug: orgProject.orgSlug,
            projectSlug: orgProject.projectSlug ?? issue.project?.slug ?? null,
            issue,
            action,
            actor,
          }),
        ],
        syncTasks: projectSyncTask({
          integrationId: integration.id,
          teamId: integration.teamId,
          project,
        }),
      };
    }

    const release = sentryReleaseFromRecord(nestedRecord(data, 'release'));
    if (release && orgProject.orgSlug && orgProject.projectSlug) {
      return {
        events: [releaseEvent(orgProject.orgSlug, orgProject.projectSlug, release, action)],
        syncTasks: projectSyncTask({
          integrationId: integration.id,
          teamId: integration.teamId,
          project,
        }),
      };
    }

    const issueId =
      stringValue(event?.issue_id) ?? stringValue(data.issue_id) ?? stringValue(record.issue_id);
    if (!issueId) {
      return {
        events: [],
        syncTasks: projectSyncTask({
          integrationId: integration.id,
          teamId: integration.teamId,
          project,
        }),
      };
    }
    const occurredAt = dateValue(event?.datetime ?? data.timestamp);
    const title =
      stringValue(event?.title) ?? stringValue(event?.message) ?? `Sentry issue ${issueId}`;
    const webUrl = stringValue(event?.web_url);
    return {
      events: [
        {
          dedupKey: `sentry:webhook:${issueId}:${occurredAt.toISOString()}:${action}`,
          provider: 'sentry',
          externalObjectId: issueId,
          eventType: action === 'resolved' ? 'issue.resolved' : 'alert.triggered',
          occurredAt,
          actor: actorFromRecord(actor),
          contentText: `Sentry alert: ${title}`,
          extra: { sentry_issue_id: issueId, webhook_action: action || null },
          objectMap: {
            type: 'incident',
            canonicalName: title,
            displayTitle: title,
            externalId: issueId,
            status: action === 'resolved' ? 'done' : 'open',
            ...(webUrl ? { url: webUrl } : {}),
            metadata: {
              sentry_org_slug: orgProject.orgSlug,
              sentry_project_slug: orgProject.projectSlug,
              sentry_issue_id: issueId,
              webhook_action: action || null,
            },
          },
        },
      ],
      syncTasks: projectSyncTask({
        integrationId: integration.id,
        teamId: integration.teamId,
        project,
      }),
    };
  },
};
