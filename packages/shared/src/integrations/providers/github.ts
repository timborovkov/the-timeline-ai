import type {
  IntegrationEvent,
  IntegrationProvider,
  OAuthCallbackInput,
  OAuthStartInput,
  ProviderResource,
  SyncContext,
} from '#src/integrations/types.js';

import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';

// Phase 11 — GitHub provider.
//
// OAuth App (user-to-server) for now — straightforward, full repo:read scope.
// A future revision swaps to a GitHub App with installation tokens for
// finer-grained perms and first-class installation webhooks.
//
// Sync surface per selected repo:
//   - Pull requests (open + closed, with merged_at)
//   - PR reviews
//   - Issues (filtered to exclude PR rows)
//   - Releases
//   - Recent commits on the default branch
//   - Workflow runs (CI state)

const log = childLogger('integrations:github');

const AUTH_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

const SCOPES = ['repo', 'read:org'];
export const GITHUB_RATE_LIMIT_CODE = 'github_rate_limited';
const GITHUB_QUOTA_RESERVE = 250;
const GITHUB_ORG_REPO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type GithubRateLimitKind = 'primary' | 'secondary' | 'unknown';

export class GithubRateLimitError extends Error {
  readonly code = GITHUB_RATE_LIMIT_CODE;
  readonly provider = 'github';
  readonly retryAt: Date;
  readonly retryAfterSeconds: number;
  readonly rateLimitKind: GithubRateLimitKind;
  readonly path: string;

  constructor(input: {
    path: string;
    retryAt: Date;
    retryAfterSeconds: number;
    rateLimitKind: GithubRateLimitKind;
  }) {
    super(
      `github_rate_limited: GitHub API rate limit reached; retry after ${input.retryAt.toISOString()}`,
    );
    this.name = 'GithubRateLimitError';
    this.path = input.path;
    this.retryAt = input.retryAt;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.rateLimitKind = input.rateLimitKind;
  }
}

interface GithubTokens {
  access_token: string;
  refresh_token?: string;
  refresh_token_expires_at?: number;
  scope?: string;
  token_type?: string;
  expires_at?: number;
}

interface GithubRequestBudget {
  remaining?: number;
  resetAt?: Date;
  limitedPath?: string;
}

interface GithubOrgRepoCursor {
  repos?: string[];
  fetched_at?: string;
}

/**
 * Refresh a GitHub App user-to-server access token. GitHub Apps with the
 * "expire user authorization tokens" option issue 8-hour access tokens
 * + 6-month refresh tokens; the legacy OAuth-app path issues long-lived
 * tokens without a refresh leg. Returns the input unchanged when no
 * refresh_token is stored (legacy install or the option is disabled).
 */
async function ensureGithubAccessToken(tokens: GithubTokens): Promise<GithubTokens> {
  const env = getEnv();
  if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) return tokens;
  const now = Date.now();
  // 60s skew on access-token expiry — concurrent in-flight calls don't
  // hit a 401 race on GitHub's side.
  if (tokens.expires_at && tokens.expires_at > now + 60_000) return tokens;
  if (!tokens.refresh_token) return tokens;
  // Refresh-token has its own 6-month TTL; surfacing this lets the
  // caller catch it explicitly and surface needs_reauth.
  if (tokens.refresh_token_expires_at && tokens.refresh_token_expires_at <= now) {
    throw new Error('github_refresh_token_expired — reconnect required');
  }
  const body = await postJson(TOKEN_URL, {
    client_id: env.GITHUB_APP_CLIENT_ID,
    client_secret: env.GITHUB_APP_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  const access = typeof body.access_token === 'string' ? body.access_token : '';
  if (!access) return tokens;
  const expiresIn = Number(body.expires_in ?? 0);
  const refreshExpiresIn = Number(body.refresh_token_expires_in ?? 0);
  return {
    ...tokens,
    access_token: access,
    ...(expiresIn ? { expires_at: now + expiresIn * 1000 } : {}),
    ...(typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {}),
    ...(refreshExpiresIn ? { refresh_token_expires_at: now + refreshExpiresIn * 1000 } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

async function postJson(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
      `GitHub ${String(res.status)}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`,
    );
  }
  return parsed as Record<string, unknown>;
}

async function ghGet<T>(
  tokens: GithubTokens,
  path: string,
  budget?: GithubRequestBudget,
): Promise<T> {
  throwIfQuotaReserveReached(budget, path);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${tokens.access_token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  const text = await res.text();
  updateQuotaBudget(budget, path, res);
  if (!res.ok) {
    const rateLimit = githubRateLimitError(path, res, text);
    if (rateLimit) throw rateLimit;
    throw new Error(githubErrorMessage(path, res.status, text));
  }
  return JSON.parse(text) as T;
}

function updateQuotaBudget(
  budget: GithubRequestBudget | undefined,
  path: string,
  res: Response,
): void {
  if (!budget) return;
  const remaining = parseNonNegativeInt(res.headers.get('x-ratelimit-remaining'));
  const resetEpoch = parsePositiveInt(res.headers.get('x-ratelimit-reset'));
  if (remaining === null || resetEpoch === null) return;
  budget.remaining = remaining;
  budget.resetAt = new Date(resetEpoch * 1000);
  if (remaining <= GITHUB_QUOTA_RESERVE && budget.resetAt.getTime() > Date.now()) {
    budget.limitedPath = path;
  }
}

function throwIfQuotaReserveReached(budget: GithubRequestBudget | undefined, path: string): void {
  if (
    !budget?.resetAt ||
    budget.remaining === undefined ||
    budget.remaining > GITHUB_QUOTA_RESERVE ||
    budget.resetAt.getTime() <= Date.now()
  ) {
    return;
  }
  throw new GithubRateLimitError({
    path: budget.limitedPath ?? path,
    retryAt: budget.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((budget.resetAt.getTime() - Date.now()) / 1000)),
    rateLimitKind: 'primary',
  });
}

function githubRateLimitError(
  path: string,
  res: Response,
  body: string,
): GithubRateLimitError | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = parsePositiveInt(res.headers.get('retry-after'));
  const remaining = res.headers.get('x-ratelimit-remaining');
  const resetEpoch = parsePositiveInt(res.headers.get('x-ratelimit-reset'));
  const secondary = /secondary rate limit|abuse detection|too many requests/i.test(body);
  const primary = remaining === '0';
  if (!retryAfter && !primary && !secondary && res.status !== 429) return null;

  const now = Date.now();
  const resetMs = resetEpoch ? resetEpoch * 1000 : null;
  const retryAtMs =
    retryAfter !== null
      ? now + retryAfter * 1000
      : resetMs && resetMs > now
        ? resetMs
        : now + 60_000;
  return new GithubRateLimitError({
    path,
    retryAt: new Date(retryAtMs),
    retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - now) / 1000)),
    rateLimitKind: primary ? 'primary' : secondary ? 'secondary' : 'unknown',
  });
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isGithubRateLimitError(err: unknown): err is GithubRateLimitError {
  return (
    err instanceof GithubRateLimitError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === GITHUB_RATE_LIMIT_CODE)
  );
}

function githubErrorMessage(path: string, status: number, body: string): string {
  if ((status === 401 || status === 403) && /^\/repos\/[^/]+\/[^/]+\/pulls(?:\?|$)/u.test(path)) {
    return `GitHub Pull requests read permission required; update the GitHub App repository permissions and reconnect (GET ${path} ${String(status)}): ${body}`;
  }
  return `GitHub GET ${path} ${String(status)}: ${body}`;
}

function summarizeGithubFailure(message: string): string {
  if (message.includes('Pull requests read permission required')) {
    return 'Pull requests read permission required; update GitHub App repository permissions and reconnect';
  }
  return message.slice(0, 80);
}

interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
}

interface GhOrg {
  login: string;
  id: number;
}

interface GhPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  updated_at: string;
  user: { login: string } | null;
  base: { ref: string };
  head: { ref: string };
}

interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  updated_at: string;
  user: { login: string } | null;
  pull_request?: { html_url: string };
}

interface GhReview {
  id: number;
  body: string | null;
  state: string;
  submitted_at?: string | null;
  user: { login: string } | null;
  html_url: string;
}

interface GhRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  author: { login: string } | null;
}

interface GhCommit {
  sha: string;
  html_url: string;
  commit: {
    author: { name?: string; email?: string; date?: string } | null;
    committer: { name?: string; email?: string; date?: string } | null;
    message: string;
  };
  author: { login: string } | null;
}

interface GhWorkflowRun {
  id: number;
  name: string | null;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  workflow_id: number;
  html_url: string;
  run_number: number;
  event: string;
  created_at: string;
  updated_at: string;
  actor: { login: string } | null;
}

interface RepoCursor {
  /** Legacy ISO timestamp used before per-surface cursors existed. */
  since?: string;
  /** ISO timestamp; used for PR + PR review polling. */
  prs_since?: string;
  /** ISO timestamp; used for issue polling. */
  issues_since?: string;
  /** ISO timestamp; used for release polling. */
  releases_since?: string;
  /** ISO timestamp; used for workflow run polling. */
  workflow_runs_since?: string;
  /** Last commit sha we processed; used for commit feed. */
  last_sha?: string;
  /** Previous high-water sha we still need to find while draining a large commit burst. */
  commit_gap_target_sha?: string;
  /** New high-water sha to promote once the commit gap has been drained. */
  commit_gap_high_water_sha?: string;
  /** GitHub `until` boundary used to continue draining a large commit burst. */
  commit_gap_until?: string;
  /** Legacy release cursor; retained for old rows. */
  last_release_id?: number;
  /** Last time this surface was polled, used to slow down lower-value surfaces. */
  last_polled_at?: string;
}

const MAX_SYNC_PAGES = 20;
const GITHUB_RELEASE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GITHUB_WORKFLOW_RUN_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;
type GithubRepoSurface = 'prs' | 'issues' | 'releases' | 'commits' | 'workflow_runs';

interface GithubSurfaceFailure {
  repo: string;
  surface: GithubRepoSurface;
  area: string;
  error: string;
}

function maxIso(current: string | undefined, candidate: string): string {
  return !current || candidate > current ? candidate : current;
}

function commitTimestamp(commit: GhCommit): string {
  return commit.commit.committer?.date ?? commit.commit.author?.date ?? new Date(0).toISOString();
}

function commitGapUntil(commit: GhCommit): string {
  const timestamp = commitTimestamp(commit);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return new Date(parsed.getTime() + 1000).toISOString();
}

function clearCommitGap(cursor: RepoCursor): void {
  Object.assign(cursor, {
    commit_gap_target_sha: undefined,
    commit_gap_high_water_sha: undefined,
    commit_gap_until: undefined,
  });
}

function repoSurfaceResourceType(repo: string, surface: GithubRepoSurface): string {
  return `github.repo:${repo}:${surface}`;
}

function surfaceCursor(
  surface: GithubRepoSurface,
  existingCursor: RepoCursor,
  legacyCursor: RepoCursor,
): RepoCursor {
  const legacy: RepoCursor = {};
  if (surface === 'prs') {
    const since = legacyCursor.prs_since ?? legacyCursor.since;
    if (since) {
      legacy.prs_since = since;
      legacy.since = since;
    }
  } else if (surface === 'issues') {
    const since = legacyCursor.issues_since ?? legacyCursor.since;
    if (since) {
      legacy.issues_since = since;
      legacy.since = since;
    }
  } else if (surface === 'releases') {
    if (legacyCursor.releases_since) legacy.releases_since = legacyCursor.releases_since;
    if (legacyCursor.last_release_id !== undefined)
      legacy.last_release_id = legacyCursor.last_release_id;
  } else if (surface === 'commits') {
    if (legacyCursor.last_sha) legacy.last_sha = legacyCursor.last_sha;
    if (legacyCursor.commit_gap_target_sha) {
      legacy.commit_gap_target_sha = legacyCursor.commit_gap_target_sha;
    }
    if (legacyCursor.commit_gap_high_water_sha) {
      legacy.commit_gap_high_water_sha = legacyCursor.commit_gap_high_water_sha;
    }
    if (legacyCursor.commit_gap_until) legacy.commit_gap_until = legacyCursor.commit_gap_until;
  } else {
    const since = legacyCursor.workflow_runs_since ?? legacyCursor.since;
    if (since) {
      legacy.workflow_runs_since = since;
      legacy.since = since;
    }
  }
  return { ...legacy, ...existingCursor };
}

function markPolled(cursor: RepoCursor): RepoCursor {
  return { ...cursor, last_polled_at: new Date().toISOString() };
}

function surfaceDue(cursor: RepoCursor, intervalMs: number): boolean {
  if (!cursor.last_polled_at) return true;
  const lastPolledAt = new Date(cursor.last_polled_at);
  return Number.isNaN(lastPolledAt.getTime()) || Date.now() - lastPolledAt.getTime() >= intervalMs;
}

async function loadRepoSurfaceCursor(
  ctx: SyncContext,
  repo: string,
  surface: GithubRepoSurface,
  legacyCursor: RepoCursor,
): Promise<RepoCursor> {
  const cursor = (await ctx.loadCursor(repoSurfaceResourceType(repo, surface))) as RepoCursor;
  return surfaceCursor(surface, cursor, legacyCursor);
}

async function saveRepoSurfaceCursor(
  ctx: SyncContext,
  repo: string,
  surface: GithubRepoSurface,
  cursor: RepoCursor,
  status?: { lastStatus?: string; lastError?: string | null },
): Promise<void> {
  await ctx.saveCursor(repoSurfaceResourceType(repo, surface), markPolled(cursor), status);
}

async function saveRepoSurfaceFailure(
  ctx: SyncContext,
  repo: string,
  surface: GithubRepoSurface,
  cursor: RepoCursor,
  error: string,
): Promise<void> {
  await saveRepoSurfaceCursor(ctx, repo, surface, cursor, {
    lastStatus: 'error',
    lastError: error.slice(0, 500),
  });
}

function buildAuthorizeUrl(input: OAuthStartInput): string {
  const env = getEnv();
  if (!env.GITHUB_APP_CLIENT_ID) throw new Error('GITHUB_APP_CLIENT_ID not configured');
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

function repoDisplayName(repo: string): string {
  return repo.split('/').pop() ?? repo;
}

function prToEvent(repo: string, pr: GhPullRequest): IntegrationEvent {
  const eventType = pr.merged_at ? 'pr.merged' : pr.state === 'closed' ? 'pr.closed' : 'pr.updated';
  const status: 'open' | 'done' | 'cancelled' = pr.merged_at
    ? 'done'
    : pr.state === 'closed'
      ? 'cancelled'
      : 'open';
  const externalId = `${repo}#${String(pr.number)}`;
  return {
    dedupKey: `github:pr:${String(pr.id)}:${pr.updated_at}`,
    provider: 'github',
    externalObjectId: externalId,
    externalEventId: pr.updated_at,
    eventType,
    occurredAt: new Date(pr.updated_at),
    actor: pr.user ? { externalId: pr.user.login, name: pr.user.login } : null,
    contentText: `GitHub PR ${repo}#${String(pr.number)} — ${pr.title}${pr.body ? `\n\n${pr.body}` : ''}`,
    extra: {
      github: {
        type: 'pull_request',
        repo,
        number: pr.number,
        url: pr.html_url,
        state: pr.state,
        merged_at: pr.merged_at,
        base: pr.base.ref,
        head: pr.head.ref,
      },
    },
    objectMap: {
      type: 'task',
      canonicalName: `${repo}#${String(pr.number)}: ${pr.title}`,
      displayTitle: `${repoDisplayName(repo)}: ${pr.title}`,
      externalId,
      status,
      url: pr.html_url,
      aliases: [`PR-${repo}-${String(pr.number)}`],
    },
  };
}

function issueToEvent(repo: string, issue: GhIssue): IntegrationEvent | null {
  if (issue.pull_request) return null;
  const externalId = `${repo}#issue:${String(issue.number)}`;
  return {
    dedupKey: `github:issue:${String(issue.id)}:${issue.updated_at}`,
    provider: 'github',
    externalObjectId: externalId,
    externalEventId: issue.updated_at,
    eventType: issue.state === 'closed' ? 'issue.closed' : 'issue.updated',
    occurredAt: new Date(issue.updated_at),
    actor: issue.user ? { externalId: issue.user.login, name: issue.user.login } : null,
    contentText: `GitHub Issue ${repo}#${String(issue.number)} — ${issue.title}${issue.body ? `\n\n${issue.body}` : ''}`,
    extra: {
      github: {
        type: 'issue',
        repo,
        number: issue.number,
        url: issue.html_url,
        state: issue.state,
      },
    },
    objectMap: {
      type: 'task',
      canonicalName: `${repo}#${String(issue.number)}: ${issue.title}`,
      displayTitle: `${repoDisplayName(repo)}: ${issue.title}`,
      externalId,
      status: issue.state === 'closed' ? 'done' : 'open',
      url: issue.html_url,
      aliases: [`ISSUE-${repo}-${String(issue.number)}`],
    },
  };
}

function reviewToEvent(repo: string, prNumber: number, review: GhReview): IntegrationEvent | null {
  const ts = review.submitted_at;
  if (!ts) return null;
  return {
    dedupKey: `github:review:${String(review.id)}:${ts}`,
    provider: 'github',
    externalObjectId: `${repo}#${String(prNumber)}:review:${String(review.id)}`,
    externalEventId: ts,
    eventType: `pr.review.${review.state.toLowerCase()}`,
    occurredAt: new Date(ts),
    actor: review.user ? { externalId: review.user.login, name: review.user.login } : null,
    contentText: `GitHub PR ${repo}#${String(prNumber)} review (${review.state})${review.body ? `: ${review.body}` : ''}`,
    extra: {
      github: {
        type: 'review',
        repo,
        pr_number: prNumber,
        url: review.html_url,
        state: review.state,
      },
    },
  };
}

function releaseToEvent(repo: string, release: GhRelease): IntegrationEvent {
  const ts = release.published_at ?? release.created_at;
  const externalId = `${repo}#release:${release.tag_name}`;
  return {
    dedupKey: `github:release:${String(release.id)}:${ts}`,
    provider: 'github',
    externalObjectId: externalId,
    externalEventId: ts,
    eventType: release.draft
      ? 'release.draft'
      : release.prerelease
        ? 'release.prerelease'
        : 'release.published',
    occurredAt: new Date(ts),
    actor: release.author ? { externalId: release.author.login, name: release.author.login } : null,
    contentText: `GitHub Release ${repo} ${release.tag_name}${release.name ? ` — ${release.name}` : ''}${release.body ? `\n\n${release.body}` : ''}`,
    extra: {
      github: {
        type: 'release',
        repo,
        tag: release.tag_name,
        url: release.html_url,
        draft: release.draft,
        prerelease: release.prerelease,
      },
    },
    objectMap: {
      type: 'other',
      canonicalName: `${repo} ${release.tag_name}`,
      externalId,
      status: release.draft ? 'open' : 'done',
      url: release.html_url,
    },
  };
}

function commitToEvent(repo: string, commit: GhCommit): IntegrationEvent {
  const ts =
    commit.commit.committer?.date ?? commit.commit.author?.date ?? new Date().toISOString();
  return {
    dedupKey: `github:commit:${commit.sha}`,
    provider: 'github',
    externalObjectId: `${repo}#commit:${commit.sha}`,
    externalEventId: ts,
    eventType: 'commit.pushed',
    occurredAt: new Date(ts),
    actor: commit.author
      ? { externalId: commit.author.login, name: commit.author.login }
      : commit.commit.author
        ? {
            ...(commit.commit.author.name ? { name: commit.commit.author.name } : {}),
            ...(commit.commit.author.email ? { email: commit.commit.author.email } : {}),
          }
        : null,
    contentText: `GitHub commit ${repo}@${commit.sha.slice(0, 7)} — ${commit.commit.message}`,
    extra: {
      github: { type: 'commit', repo, sha: commit.sha, url: commit.html_url },
    },
  };
}

function workflowRunToEvent(repo: string, run: GhWorkflowRun): IntegrationEvent {
  return {
    dedupKey: `github:workflow_run:${String(run.id)}:${run.updated_at}`,
    provider: 'github',
    externalObjectId: `${repo}#workflow_run:${String(run.id)}`,
    externalEventId: run.updated_at,
    eventType: run.conclusion
      ? `workflow_run.${run.conclusion}`
      : `workflow_run.${run.status ?? 'updated'}`,
    occurredAt: new Date(run.updated_at),
    actor: run.actor ? { externalId: run.actor.login, name: run.actor.login } : null,
    contentText: `GitHub workflow "${run.name ?? String(run.workflow_id)}" #${String(run.run_number)} on ${repo} ${run.conclusion ?? run.status ?? 'updated'}`,
    extra: {
      github: {
        type: 'workflow_run',
        repo,
        url: run.html_url,
        status: run.status,
        conclusion: run.conclusion,
        head_branch: run.head_branch,
        head_sha: run.head_sha,
        event: run.event,
      },
    },
  };
}

async function syncRepo(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  options: { mode: 'backfill' | 'incremental'; legacyCursor?: RepoCursor },
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const legacyCursor = options.legacyCursor ?? {};
  const failures: GithubSurfaceFailure[] = [];
  failures.push(...(await syncPullRequestsSurface(tokens, repo, ctx, legacyCursor, budget)));
  failures.push(...(await syncIssuesSurface(tokens, repo, ctx, legacyCursor, budget)));
  failures.push(
    ...(await syncReleasesSurface(tokens, repo, ctx, legacyCursor, options.mode, budget)),
  );
  failures.push(...(await syncCommitsSurface(tokens, repo, ctx, legacyCursor, budget)));
  failures.push(
    ...(await syncWorkflowRunsSurface(tokens, repo, ctx, legacyCursor, options.mode, budget)),
  );
  return failures;
}

async function syncPullRequestsSurface(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  legacyCursor: RepoCursor,
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const cursor = await loadRepoSurfaceCursor(ctx, repo, 'prs', legacyCursor);
  const next: RepoCursor = { ...cursor };
  const legacySince = cursor.since ?? new Date(0).toISOString();
  const prsSince = cursor.prs_since ?? legacySince;
  const failures: GithubSurfaceFailure[] = [];
  for (const state of ['open', 'closed'] as const) {
    try {
      for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
        const prs = await ghGet<GhPullRequest[]>(
          tokens,
          `/repos/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${String(page)}`,
          budget,
        );
        if (prs.length === 0) break;
        const filtered = prs.filter((p) => p.updated_at > prsSince);
        if (filtered.length > 0) {
          await ctx.writeEvents(filtered.map((pr) => prToEvent(repo, pr)));
          for (const pr of filtered) {
            next.prs_since = maxIso(next.prs_since, pr.updated_at);
            next.since = maxIso(next.since, pr.updated_at);
          }
          // Also fetch reviews for these PRs.
          for (const pr of filtered) {
            try {
              for (let reviewPage = 1; reviewPage <= MAX_SYNC_PAGES; reviewPage++) {
                const reviews = await ghGet<GhReview[]>(
                  tokens,
                  `/repos/${repo}/pulls/${String(pr.number)}/reviews?per_page=100&page=${String(reviewPage)}`,
                  budget,
                );
                if (reviews.length === 0) break;
                const reviewEvents = reviews
                  .map((r) => reviewToEvent(repo, pr.number, r))
                  .filter((e): e is IntegrationEvent => e !== null);
                if (reviewEvents.length > 0) await ctx.writeEvents(reviewEvents);
                if (reviews.length < 100) break;
                if (reviewPage === MAX_SYNC_PAGES) {
                  failures.push({
                    repo,
                    surface: 'prs',
                    area: `reviews:${String(pr.number)}:page_cap`,
                    error: `hit ${String(MAX_SYNC_PAGES)} review pages without reaching the end`,
                  });
                }
              }
            } catch (err) {
              if (isGithubRateLimitError(err)) throw err;
              log.warn({ err, repo, pr: pr.number }, 'fetching reviews failed');
              failures.push({
                repo,
                surface: 'prs',
                area: `reviews:${String(pr.number)}`,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        if (filtered.length < prs.length || prs.length < 100) break;
        if (page === MAX_SYNC_PAGES) {
          failures.push({
            repo,
            surface: 'prs',
            area: `prs:${state}:page_cap`,
            error: `hit ${String(MAX_SYNC_PAGES)} pages without reaching cursor`,
          });
        }
      }
    } catch (err) {
      if (isGithubRateLimitError(err)) throw err;
      log.warn({ err, repo, state }, 'github PR fetch failed');
      failures.push({
        repo,
        surface: 'prs',
        area: `prs:${state}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (failures.length === 0) {
    await saveRepoSurfaceCursor(ctx, repo, 'prs', next);
  } else {
    await saveRepoSurfaceFailure(ctx, repo, 'prs', cursor, summarizeSurfaceFailures(failures));
  }
  return failures;
}

async function syncIssuesSurface(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  legacyCursor: RepoCursor,
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const cursor = await loadRepoSurfaceCursor(ctx, repo, 'issues', legacyCursor);
  const next: RepoCursor = { ...cursor };
  const legacySince = cursor.since ?? new Date(0).toISOString();
  const issuesSince = cursor.issues_since ?? legacySince;
  const failures: GithubSurfaceFailure[] = [];
  try {
    for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
      const issues = await ghGet<GhIssue[]>(
        tokens,
        `/repos/${repo}/issues?state=all&since=${encodeURIComponent(issuesSince)}&sort=updated&direction=desc&per_page=100&page=${String(page)}`,
        budget,
      );
      if (issues.length === 0) break;
      const issueEvents = issues
        .map((i) => issueToEvent(repo, i))
        .filter((e): e is IntegrationEvent => e !== null);
      if (issueEvents.length > 0) {
        await ctx.writeEvents(issueEvents);
      }
      for (const i of issues) {
        next.issues_since = maxIso(next.issues_since, i.updated_at);
        next.since = maxIso(next.since, i.updated_at);
      }
      if (issues.length < 100) break;
      if (page === MAX_SYNC_PAGES) {
        failures.push({
          repo,
          surface: 'issues',
          area: 'issues:page_cap',
          error: `hit ${String(MAX_SYNC_PAGES)} pages without reaching the end`,
        });
      }
    }
  } catch (err) {
    if (isGithubRateLimitError(err)) throw err;
    log.warn({ err, repo }, 'github issues fetch failed');
    failures.push({
      repo,
      surface: 'issues',
      area: 'issues',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (failures.length === 0) {
    await saveRepoSurfaceCursor(ctx, repo, 'issues', next);
  } else {
    await saveRepoSurfaceFailure(ctx, repo, 'issues', cursor, summarizeSurfaceFailures(failures));
  }
  return failures;
}

async function syncReleasesSurface(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  legacyCursor: RepoCursor,
  mode: 'backfill' | 'incremental',
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const cursor = await loadRepoSurfaceCursor(ctx, repo, 'releases', legacyCursor);
  if (mode === 'incremental' && !surfaceDue(cursor, GITHUB_RELEASE_SYNC_INTERVAL_MS)) return [];
  const next: RepoCursor = { ...cursor };
  const releasesSince = cursor.releases_since ?? new Date(0).toISOString();
  const failures: GithubSurfaceFailure[] = [];
  try {
    const hasReleaseSince = Boolean(cursor.releases_since);
    const legacyLastReleaseId = cursor.last_release_id ?? 0;
    for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
      const releases = await ghGet<GhRelease[]>(
        tokens,
        `/repos/${repo}/releases?per_page=100&page=${String(page)}`,
        budget,
      );
      if (releases.length === 0) break;
      const newReleases = releases.filter((r) => {
        const releaseTs = r.published_at ?? r.created_at;
        return hasReleaseSince ? releaseTs > releasesSince : r.id >= legacyLastReleaseId;
      });
      if (newReleases.length > 0) {
        await ctx.writeEvents(newReleases.map((r) => releaseToEvent(repo, r)));
        next.last_release_id = Math.max(next.last_release_id ?? 0, ...newReleases.map((r) => r.id));
        for (const release of newReleases) {
          next.releases_since = maxIso(
            next.releases_since,
            release.published_at ?? release.created_at,
          );
        }
      }
      if (!hasReleaseSince) {
        for (const release of releases) {
          if (release.id <= legacyLastReleaseId) {
            next.releases_since = maxIso(next.releases_since, release.created_at);
          }
        }
      }
      if (newReleases.length === 0 || releases.length < 100) break;
      if (page === MAX_SYNC_PAGES) {
        failures.push({
          repo,
          surface: 'releases',
          area: 'releases:page_cap',
          error: `hit ${String(MAX_SYNC_PAGES)} pages without reaching the end`,
        });
      }
    }
  } catch (err) {
    if (isGithubRateLimitError(err)) throw err;
    log.warn({ err, repo }, 'github releases fetch failed');
    failures.push({
      repo,
      surface: 'releases',
      area: 'releases',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (failures.length === 0) {
    await saveRepoSurfaceCursor(ctx, repo, 'releases', next);
  } else {
    await saveRepoSurfaceFailure(ctx, repo, 'releases', cursor, summarizeSurfaceFailures(failures));
  }
  return failures;
}

async function syncCommitsSurface(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  legacyCursor: RepoCursor,
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const cursor = await loadRepoSurfaceCursor(ctx, repo, 'commits', legacyCursor);
  const next: RepoCursor = { ...cursor };
  const failures: GithubSurfaceFailure[] = [];
  try {
    const meta = await ghGet<GhRepo>(tokens, `/repos/${repo}`, budget);
    const gapTargetSha = cursor.commit_gap_target_sha;
    const lastSha = gapTargetSha ?? cursor.last_sha;
    let newest: string | undefined = gapTargetSha ? cursor.commit_gap_high_water_sha : undefined;
    let sawLastSha = false;
    let reachedCommitEnd = false;
    let oldestProcessedAt: string | undefined;
    let nextGapUntil: string | undefined;
    const untilParam = cursor.commit_gap_until
      ? `&until=${encodeURIComponent(cursor.commit_gap_until)}`
      : '';
    for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
      const commits = await ghGet<GhCommit[]>(
        tokens,
        `/repos/${repo}/commits?sha=${encodeURIComponent(meta.default_branch)}&per_page=100&page=${String(page)}${untilParam}`,
        budget,
      );
      if (commits.length === 0) {
        reachedCommitEnd = true;
        break;
      }
      const fresh: GhCommit[] = [];
      for (const c of commits) {
        newest ??= c.sha;
        oldestProcessedAt = commitTimestamp(c);
        nextGapUntil = commitGapUntil(c);
        if (lastSha && c.sha === lastSha) {
          sawLastSha = true;
          break;
        }
        fresh.push(c);
      }
      if (fresh.length > 0) {
        await ctx.writeEvents(fresh.map((c) => commitToEvent(repo, c)));
      }
      if (sawLastSha) break;
      if (commits.length < 100) {
        reachedCommitEnd = true;
        break;
      }
      if (page === MAX_SYNC_PAGES) {
        if (lastSha) {
          next.commit_gap_target_sha = lastSha;
          if (newest) next.commit_gap_high_water_sha = newest;
          if (nextGapUntil) next.commit_gap_until = nextGapUntil;
          await ctx.recordAudit('github_commit_gap_checkpoint', {
            repo,
            targetSha: lastSha,
            highWaterSha: newest ?? null,
            until: nextGapUntil ?? null,
            oldestProcessedAt: oldestProcessedAt ?? null,
            pages: MAX_SYNC_PAGES,
          });
        } else {
          await ctx.recordAudit('github_commit_history_truncated', {
            repo,
            highWaterSha: newest ?? null,
            oldestProcessedAt: oldestProcessedAt ?? null,
            pages: MAX_SYNC_PAGES,
          });
        }
      }
    }
    if (lastSha && reachedCommitEnd && !sawLastSha) {
      await ctx.recordAudit('github_commit_cursor_target_missing', {
        repo,
        targetSha: lastSha,
        promotedSha: newest ?? null,
      });
    }
    if (newest && (!lastSha || sawLastSha || reachedCommitEnd)) {
      next.last_sha = newest;
      clearCommitGap(next);
    }
  } catch (err) {
    if (isGithubRateLimitError(err)) throw err;
    log.warn({ err, repo }, 'github commits fetch failed');
    failures.push({
      repo,
      surface: 'commits',
      area: 'commits',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (failures.length === 0) {
    await saveRepoSurfaceCursor(ctx, repo, 'commits', next);
  } else {
    await saveRepoSurfaceFailure(ctx, repo, 'commits', cursor, summarizeSurfaceFailures(failures));
  }
  return failures;
}

async function syncWorkflowRunsSurface(
  tokens: GithubTokens,
  repo: string,
  ctx: SyncContext,
  legacyCursor: RepoCursor,
  mode: 'backfill' | 'incremental',
  budget?: GithubRequestBudget,
): Promise<GithubSurfaceFailure[]> {
  const cursor = await loadRepoSurfaceCursor(ctx, repo, 'workflow_runs', legacyCursor);
  if (mode === 'incremental' && !surfaceDue(cursor, GITHUB_WORKFLOW_RUN_SYNC_INTERVAL_MS))
    return [];
  const next: RepoCursor = { ...cursor };
  const legacySince = cursor.since ?? new Date(0).toISOString();
  const workflowRunsSince = cursor.workflow_runs_since ?? legacySince;
  const failures: GithubSurfaceFailure[] = [];
  try {
    for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
      const runs = await ghGet<{ workflow_runs: GhWorkflowRun[] }>(
        tokens,
        `/repos/${repo}/actions/runs?per_page=100&page=${String(page)}`,
        budget,
      );
      const workflowRuns = runs.workflow_runs;
      if (workflowRuns.length === 0) break;
      const filtered = workflowRuns.filter((r) => r.updated_at > workflowRunsSince);
      if (filtered.length > 0) {
        await ctx.writeEvents(filtered.map((r) => workflowRunToEvent(repo, r)));
        for (const r of filtered) {
          next.workflow_runs_since = maxIso(next.workflow_runs_since, r.updated_at);
          next.since = maxIso(next.since, r.updated_at);
        }
      }
      if (filtered.length === 0 || workflowRuns.length < 100) break;
      if (page === MAX_SYNC_PAGES) {
        failures.push({
          repo,
          surface: 'workflow_runs',
          area: 'workflow_runs:page_cap',
          error: `hit ${String(MAX_SYNC_PAGES)} pages without reaching the end`,
        });
      }
    }
  } catch (err) {
    if (isGithubRateLimitError(err)) throw err;
    log.warn({ err, repo }, 'github workflow runs fetch failed');
    failures.push({
      repo,
      surface: 'workflow_runs',
      area: 'workflow_runs',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (failures.length === 0) {
    await saveRepoSurfaceCursor(ctx, repo, 'workflow_runs', next);
  } else {
    await saveRepoSurfaceFailure(
      ctx,
      repo,
      'workflow_runs',
      cursor,
      summarizeSurfaceFailures(failures),
    );
  }
  return failures;
}

function summarizeSurfaceFailures(failures: GithubSurfaceFailure[]): string {
  return failures
    .map((f) => `${f.area} (${summarizeGithubFailure(f.error)})`)
    .join('; ')
    .slice(0, 400);
}

async function listOrgRepos(
  tokens: GithubTokens,
  org: string,
  budget?: GithubRequestBudget,
): Promise<string[]> {
  const repos: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await ghGet<GhRepo[]>(
      tokens,
      `/orgs/${encodeURIComponent(org)}/repos?type=all&sort=updated&direction=desc&per_page=100&page=${String(page)}`,
      budget,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch.map((repo) => repo.full_name));
    if (batch.length < 100) break;
  }
  return repos;
}

async function expandGithubSelections(
  tokens: GithubTokens,
  selections: { kind: string; externalId: string }[],
  ctx: SyncContext,
  budget?: GithubRequestBudget,
): Promise<string[]> {
  const repos = new Set<string>();
  for (const sel of selections) {
    if (sel.kind === 'github.repo') repos.add(sel.externalId);
  }
  for (const sel of selections) {
    if (sel.kind !== 'github.org') continue;
    const resourceType = `github.org:${sel.externalId}:repos`;
    const cached = (await ctx.loadCursor(resourceType)) as GithubOrgRepoCursor;
    const fetchedAt = typeof cached.fetched_at === 'string' ? new Date(cached.fetched_at) : null;
    const cacheFresh =
      Array.isArray(cached.repos) &&
      fetchedAt !== null &&
      !Number.isNaN(fetchedAt.getTime()) &&
      Date.now() - fetchedAt.getTime() < GITHUB_ORG_REPO_CACHE_TTL_MS;
    const orgRepos =
      cacheFresh && cached.repos
        ? cached.repos
        : await listOrgRepos(tokens, sel.externalId, budget);
    if (!cacheFresh) {
      await ctx.saveCursor(resourceType, {
        repos: orgRepos,
        fetched_at: new Date().toISOString(),
      } satisfies GithubOrgRepoCursor);
    }
    for (const repo of orgRepos) repos.add(repo);
  }
  return [...repos].sort();
}

export const githubProvider: IntegrationProvider = {
  id: 'github',
  displayLabel: 'GitHub',

  // eslint-disable-next-line @typescript-eslint/require-await
  async startOAuth(input) {
    return { authorizeUrl: buildAuthorizeUrl(input) };
  },

  async handleOAuthCallback(input: OAuthCallbackInput) {
    const env = getEnv();
    if (!env.GITHUB_APP_CLIENT_ID || !env.GITHUB_APP_CLIENT_SECRET) {
      throw new Error('GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET not configured');
    }
    const body = await postJson(TOKEN_URL, {
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const access = typeof body.access_token === 'string' ? body.access_token : '';
    if (!access) throw new Error('GitHub token exchange returned no access_token');
    const now = Date.now();
    const expiresIn = Number(body.expires_in ?? 0);
    const refreshExpiresIn = Number(body.refresh_token_expires_in ?? 0);
    const tokens: GithubTokens = {
      access_token: access,
      token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      scope: typeof body.scope === 'string' ? body.scope : SCOPES.join(' '),
      // GitHub App "expire user authorization tokens" installs issue
      // refresh_token + refresh_token_expires_in (6 months). Capture
      // both — without them the worker can't refresh after the 8h
      // access token lapses and the only recovery is a reconnect.
      ...(typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {}),
      ...(expiresIn ? { expires_at: now + expiresIn * 1000 } : {}),
      ...(refreshExpiresIn ? { refresh_token_expires_at: now + refreshExpiresIn * 1000 } : {}),
    };
    // externalAccountId MUST be the GitHub numeric user id so reconnects
    // upsert on the existing integration row instead of creating a new
    // one each time (the `(team_id, provider, external_account_id)` partial
    // unique index dedups on it). A random fallback would silently produce
    // duplicate integrations on every reconnect — fail the OAuth flow
    // instead and let the user retry.
    let login: string;
    let sub: string;
    try {
      const me = await ghGet<{ id: number; login: string }>(tokens, '/user');
      login = me.login;
      sub = String(me.id);
    } catch (err) {
      log.warn({ err }, 'failed to fetch GitHub /user');
      throw new Error(
        'github_user_lookup_failed: could not resolve the authenticated user id from /user — reconnect and try again',
      );
    }
    return {
      externalAccountId: sub,
      displayName: `GitHub — ${login}`,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    // Paginate `/user/repos`. Without this only the first 100 repos are
    // reachable — PUT /selections rejects anything outside this set, so
    // any repo on page 2+ can't be selected or synced.
    // Cap at 20 pages = 2000 repos: large enough that no real user hits
    // it, small enough that a misbehaving token can't brick a sync tick.
    const ghTokens = tokens as GithubTokens;
    const orgResources: ProviderResource[] = [];
    try {
      const orgs: GhOrg[] = [];
      for (let page = 1; page <= 20; page++) {
        const batch = await ghGet<GhOrg[]>(
          ghTokens,
          `/user/orgs?per_page=100&page=${String(page)}`,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        orgs.push(...batch);
        if (batch.length < 100) break;
      }
      orgResources.push(
        ...orgs.map((org) => ({
          externalId: org.login,
          label: `${org.login} (all accessible repos)`,
          kind: 'github.org',
        })),
      );
    } catch (err) {
      if (isGithubRateLimitError(err)) throw err;
      log.warn({ err }, 'listing github orgs failed');
    }
    const all: GhRepo[] = [];
    for (let page = 1; page <= 20; page++) {
      const path = `/user/repos?sort=updated&direction=desc&per_page=100&page=${String(page)}`;
      const batch = await ghGet<GhRepo[]>(ghTokens, path);
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return [
      ...orgResources,
      ...all.map((r) => ({
        externalId: r.full_name,
        label: r.full_name + (r.private ? ' (private)' : ''),
        kind: 'github.repo',
      })),
    ];
  },

  async backfill({ tokens, selections, ctx }) {
    const input = tokens as GithubTokens;
    const fresh = await ensureGithubAccessToken(input);
    if (fresh.access_token !== input.access_token) {
      await ctx.persistTokens(fresh as unknown as Record<string, unknown>);
    }
    const budget: GithubRequestBudget = {};
    const repos = await expandGithubSelections(fresh, selections, ctx, budget);
    const failures: GithubSurfaceFailure[] = [];
    for (const repo of repos) {
      failures.push(...(await syncRepo(fresh, repo, ctx, { mode: 'backfill' }, budget)));
    }
    if (failures.length > 0) {
      await ctx.recordAudit('github_backfill_partial', summarizeIntegrationFailures(failures));
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    const input = tokens as GithubTokens;
    const fresh = await ensureGithubAccessToken(input);
    if (fresh.access_token !== input.access_token) {
      await ctx.persistTokens(fresh as unknown as Record<string, unknown>);
    }
    const budget: GithubRequestBudget = {};
    const repos = await expandGithubSelections(fresh, selections, ctx, budget);
    const failures: GithubSurfaceFailure[] = [];
    for (const repo of repos) {
      const legacyCursor = (await ctx.loadCursor(`github.repo:${repo}`)) as RepoCursor;
      failures.push(
        ...(await syncRepo(fresh, repo, ctx, { mode: 'incremental', legacyCursor }, budget)),
      );
    }
    if (failures.length > 0) {
      await ctx.recordAudit('github_incremental_partial', summarizeIntegrationFailures(failures));
    }
  },
};

function summarizeIntegrationFailures(
  failures: GithubSurfaceFailure[],
): Record<string, string | number> {
  return {
    failure_count: failures.length,
    repo_count: new Set(failures.map((f) => f.repo)).size,
    summary: failures
      .map((f) => `${f.repo}:${f.surface}:${f.area} (${summarizeGithubFailure(f.error)})`)
      .join('; ')
      .slice(0, 400),
  };
}
