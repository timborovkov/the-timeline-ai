import type {
  IntegrationEvent,
  IntegrationProvider,
  ObjectMapping,
  OAuthCallbackInput,
  ProviderResource,
  TargetedSyncTask,
  SyncContext,
  SyncContinuation,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { providerFetch } from '#src/integrations/request.js';
import { attachSyncContinuation } from '#src/integrations/types.js';

const fetch = providerFetch('sentry');

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
  page?: { surface: 'issues' | 'releases'; next: string; latest: string; boundary?: string };

  issues_since?: string | undefined;
  releases_since?: string | undefined;
  /**
   * Last issued lifecycle bucket suffix per issue id (`open`, `resolved`,
   * `ignored`, or `regressed:<iso>`). Lets polling mint a distinct key when an
   * issue returns from resolved/ignored without a webhook action.
   */
  issue_lifecycles?: Record<string, string> | undefined;
}

const SENTRY_LIFECYCLE_CURSOR_CAP = 5_000;

function pruneSentryIssueLifecycles(
  map: Record<string, string>,
  keepIds: ReadonlySet<string>,
): Record<string, string> {
  const entries = Object.entries(map);
  if (entries.length <= SENTRY_LIFECYCLE_CURSOR_CAP) return map;
  const next: Record<string, string> = {};
  for (const id of keepIds) {
    const value = map[id];
    if (value) next[id] = value;
  }
  // Always retain a recent suffix so regression detection still works after a
  // cap prune even when the current page only touches a handful of issues.
  for (const [id, value] of entries.slice(-Math.floor(SENTRY_LIFECYCLE_CURSOR_CAP / 2))) {
    next[id] = value;
  }
  return next;
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
  const parsed = new URL(url);
  if (parsed.origin !== new URL(API_BASE).origin || !parsed.pathname.startsWith('/api/0/'))
    throw new Error('Invalid Sentry pagination URL');
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
  if (action === 'unresolved') return 'issue.regressed';
  if (status === 'resolved') return 'issue.resolved';
  return 'issue.updated';
}

/**
 * Lifecycle bucket used in Sentry issue dedup keys.
 *
 * Intentionally excludes `lastSeen` / occurrence timestamps for ordinary open
 * alerts. Sentry issue sync and noisy issue-alert webhooks bump `lastSeen` on
 * every new error event; putting that timestamp in the dedup key created a
 * fresh raw_event (and extract/embed/suggestions jobs) for each occurrence.
 * Resolved→unresolved regressions use a distinct `regressed:<iso>` bucket so
 * the timeline gets a new immutable source row without reopening the original
 * open alert key.
 */
function issueLifecycleBucket(
  actionOrStatus?: string | null,
): 'resolved' | 'ignored' | 'open' | 'regressed' {
  const value = (actionOrStatus ?? '').trim().toLowerCase();
  if (value === 'resolved' || value === 'done') return 'resolved';
  if (value === 'ignored' || value === 'muted') return 'ignored';
  if (value === 'regressed') return 'regressed';
  return 'open';
}

function issueDedupKey(issueId: string, lifecycleBucket: string): string {
  return `sentry:issue:${issueId}:${lifecycleBucket}`;
}

function issueStatusBucket(actionOrStatus?: string | null): 'resolved' | 'ignored' | 'open' {
  const bucket = issueLifecycleBucket(actionOrStatus);
  return bucket === 'regressed' ? 'open' : bucket;
}

function isClosedLifecycle(bucket: string | undefined): boolean {
  return bucket === 'resolved' || bucket === 'ignored';
}

/** Choose the open-family bucket, minting a new regression key when needed. */
function nextOpenFamilyBucket(previous: string | undefined, occurredAt: Date): string {
  if (isClosedLifecycle(previous)) {
    return `regressed:${occurredAt.toISOString()}`;
  }
  if (previous?.startsWith('regressed')) return previous;
  return 'open';
}

function syncIssueLifecycleBucket(issue: SentryIssue, previous: string | undefined): string {
  const status = issueStatusBucket(issue.status);
  if (status !== 'open') return status;
  return nextOpenFamilyBucket(previous, dateValue(issue.lastSeen ?? issue.firstSeen));
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

function issueEvent(
  orgSlug: string,
  projectSlug: string,
  issue: SentryIssue,
  previousLifecycle?: string,
): IntegrationEvent {
  const occurredAt = dateValue(issue.lastSeen ?? issue.firstSeen);
  const title = issue.title ?? issue.culprit ?? issue.shortId ?? `Sentry issue ${issue.id}`;
  const shortId = issue.shortId ?? issue.id;
  const priority = priorityFromLevel(issue.level);
  const permalink = issuePermalink(issue);
  const lifecycleBucket = syncIssueLifecycleBucket(issue, previousLifecycle);
  const regressed = lifecycleBucket.startsWith('regressed');
  return {
    dedupKey: issueDedupKey(issue.id, lifecycleBucket),
    provider: 'sentry',
    signalClass: 'finding',
    externalObjectId: issue.id,
    eventType:
      issue.status === 'resolved'
        ? 'issue.resolved'
        : regressed
          ? 'issue.regressed'
          : 'issue.updated',
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
  const lifecycleBucket =
    input.action === 'unresolved'
      ? nextOpenFamilyBucket('resolved', occurredAt)
      : input.action === 'ignored' || input.action === 'resolved'
        ? issueLifecycleBucket(input.action)
        : issueStatusBucket(input.issue.status ?? input.action);
  return {
    dedupKey: issueDedupKey(input.issue.id, lifecycleBucket),
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
    // Version + action only — not release timestamp — so repeated sync/webhook
    // delivery for the same release does not mint another extract job.
    dedupKey: `sentry:release:${orgSlug}:${projectSlug}:${release.version}:${action}`,
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
  ctx: SyncContext,
): Promise<SyncContinuation[]> {
  const project = `${orgSlug}/${projectSlug}`;
  const resource = `sentry.project:${project}`;
  const continuation = { resourceType: 'sentry.project', externalId: project };
  const base = `/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`;
  const state: SentryCursor = { ...cursor };
  const save = () => ctx.saveCursor(resource, state);
  try {
    for (const surface of ['issues', 'releases'] as const) {
      if (state.page?.surface === 'releases' && surface === 'issues') continue;
      const boundary =
        state.page?.boundary ?? (surface === 'issues' ? state.issues_since : state.releases_since);
      let next: string | null =
        state.page?.next ??
        `${base}/${surface}/${surface === 'issues' ? `?query=${encodeURIComponent(boundary ? `lastSeen:>${new Date(Date.parse(boundary) - 1000).toISOString()}` : '')}` : ''}`;
      let latest = state.page?.latest ?? boundary ?? '';
      for (let pageNumber = 0; next && pageNumber < 10; pageNumber++) {
        state.page = { surface, next, latest, ...(boundary ? { boundary } : {}) };
        const page = await sentryGetPage(tokens, next);
        const lifecycles = { ...state.issue_lifecycles };
        const touched = new Set<string>();
        const events =
          surface === 'issues'
            ? (page.items as SentryIssue[]).map((issue) => {
                const event = issueEvent(orgSlug, projectSlug, issue, lifecycles[issue.id]);
                lifecycles[issue.id] = event.dedupKey.slice(`sentry:issue:${issue.id}:`.length);
                touched.add(issue.id);
                return event;
              })
            : (page.items as SentryRelease[]).map((release) =>
                releaseEvent(orgSlug, projectSlug, release),
              );
        const freshEvents =
          surface === 'releases' && boundary
            ? events.filter((event) => event.occurredAt.getTime() >= Date.parse(boundary) - 1000)
            : events;
        if (freshEvents.length) await ctx.writeEvents(freshEvents);
        for (const event of events)
          if (event.occurredAt.toISOString() > latest) latest = event.occurredAt.toISOString();
        if (surface === 'issues')
          state.issue_lifecycles = pruneSentryIssueLifecycles(lifecycles, touched);
        // Sentry orders project releases by COALESCE(date_released, date_added) descending.
        const crossedBoundary =
          surface === 'releases' &&
          boundary &&
          (page.items as SentryRelease[]).some((release) => {
            const value = release.dateReleased ?? release.dateCreated ?? release.dateAdded;
            return value && Date.parse(value) < Date.parse(boundary) - 1000;
          });
        next = crossedBoundary ? null : page.next;
        if (next) state.page = { surface, next, latest, ...(boundary ? { boundary } : {}) };
        else {
          delete state.page;
          if (surface === 'issues') state.issues_since = latest || state.issues_since;
          else state.releases_since = latest || state.releases_since;
        }
        await save();
      }
      if (next) {
        if (ctx.saveCursorWithContinuations)
          await ctx.saveCursorWithContinuations(resource, state, [continuation]);
        return [continuation];
      }
    }
    return [];
  } catch (error) {
    await save();
    if (error instanceof Error) throw attachSyncContinuation(error, continuation);
    throw error;
  }
}

async function selectedProjects(
  tokens: SentryTokens,
  selections: { kind: string; externalId: string }[],
  ctx: SyncContext,
): Promise<string[]> {
  const projects = selections
    .filter((selection) => selection.kind === 'sentry.project')
    .map((selection) => selection.externalId);
  for (const selection of selections.filter((item) => item.kind === 'sentry.org')) {
    const cacheKey = `sentry.org:${selection.externalId}:projects`;
    const cache = (await ctx.loadCursor(cacheKey)) as {
      expires?: number;
      projects?: SentryProject[];
    };
    const orgProjects =
      cache.expires && cache.expires > Date.now() && cache.projects
        ? cache.projects
        : await sentryGetAll<SentryProject>(
            tokens,
            `/organizations/${encodeURIComponent(selection.externalId)}/projects/`,
          );
    await ctx.saveCursor(cacheKey, {
      expires:
        cache.expires && cache.expires > Date.now() ? cache.expires : Date.now() + 24 * 3600_000,
      projects: orgProjects,
    });
    projects.push(...orgProjects.map((project) => `${selection.externalId}/${project.slug}`));
  }
  return [...new Set(projects)];
}

async function syncSentryResources(
  { tokens, selections, ctx }: Parameters<IntegrationProvider['backfill']>[0],
  full: boolean,
) {
  const sentryTokens = await ensureAccessToken(tokens as SentryTokens, ctx);
  const projects = await selectedProjects(sentryTokens, selections, ctx);
  const continuations: SyncContinuation[] = [];
  for (const project of projects) {
    const [orgSlug, projectSlug] = project.split('/');
    if (!orgSlug || !projectSlug) continue;
    const cursor = (await ctx.loadCursor(`sentry.project:${project}`)) as SentryCursor;
    if (full && !cursor.page) {
      delete cursor.issues_since;
      delete cursor.releases_since;
    }
    continuations.push(...(await syncProject(sentryTokens, orgSlug, projectSlug, cursor, ctx)));
  }
  return continuations.length ? { continuations } : undefined;
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

  backfill(input) {
    return syncSentryResources(input, true);
  },

  async incrementalSync({ tokens, selections, ctx }) {
    return syncSentryResources({ integration: {} as never, tokens, selections, ctx }, false);
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
          dedupKey: issueDedupKey(
            issueId,
            action === 'resolved'
              ? 'resolved'
              : action === 'unresolved'
                ? nextOpenFamilyBucket('resolved', occurredAt)
                : 'open',
          ),
          provider: 'sentry',
          externalObjectId: issueId,
          eventType:
            action === 'resolved'
              ? 'issue.resolved'
              : action === 'unresolved'
                ? 'issue.regressed'
                : 'alert.triggered',
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
