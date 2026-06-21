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
  const parsed = parseJson(text);
  if (!res.ok) throw new Error(`Sentry ${String(res.status)}: ${text}`);
  return parsed;
}

async function sentryGet<T>(tokens: SentryTokens, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sentry API ${String(res.status)}: ${text}`);
  return parseJson(text) as T;
}

function parseJson(text: string): Record<string, unknown> {
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function dateValue(value: unknown, fallback = new Date()): Date {
  const raw = typeof value === 'string' || typeof value === 'number' ? new Date(value) : fallback;
  return Number.isNaN(raw.getTime()) ? fallback : raw;
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
  const issues = await sentryGet<SentryIssue[]>(
    tokens,
    `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/${query}`,
  );
  const releases = await sentryGet<SentryRelease[]>(
    tokens,
    `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/releases/`,
  ).catch(() => []);
  const events = [
    ...issues.map((issue) => issueEvent(orgSlug, projectSlug, issue)),
    ...releases.map((release) => releaseEvent(orgSlug, projectSlug, release)),
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
      issues_since: latestIssue ?? cursor.issues_since ?? new Date().toISOString(),
      releases_since: latestRelease ?? cursor.releases_since,
    },
  };
}

function selectedProjects(selections: { kind: string; externalId: string }[]): string[] {
  return selections
    .filter((selection) => selection.kind === 'sentry.project')
    .map((selection) => selection.externalId);
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
    const access = stringValue(body.access_token);
    if (!access) throw new Error('Sentry token exchange returned no access_token');
    const refreshToken = stringValue(body.refresh_token);
    const tokenType = stringValue(body.token_type);
    const scope = stringValue(body.scope);
    const tokens: SentryTokens = {
      access_token: access,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(tokenType ? { token_type: tokenType } : {}),
      ...(scope ? { scope } : {}),
    };
    const orgs = await sentryGet<SentryOrg[]>(tokens, '/organizations/');
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

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    const sentryTokens = tokens as SentryTokens;
    const orgs = await sentryGet<SentryOrg[]>(sentryTokens, '/organizations/');
    const resources: ProviderResource[] = [];
    for (const org of orgs) {
      resources.push({
        externalId: org.slug,
        label: `${org.name ?? org.slug} (all projects)`,
        kind: 'sentry.org',
      });
      const projects = await sentryGet<SentryProject[]>(
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
    const projects = selectedProjects(selections);
    for (const project of projects) {
      const [orgSlug, projectSlug] = project.split('/');
      if (!orgSlug || !projectSlug) continue;
      const cursor = (await ctx.loadCursor(`sentry.project:${project}`)) as SentryCursor;
      const result = await syncProject(tokens as SentryTokens, orgSlug, projectSlug, cursor);
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
