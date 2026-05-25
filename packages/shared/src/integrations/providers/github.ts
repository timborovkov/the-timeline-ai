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

// Phase 11 — GitHub provider.
//
// OAuth App (user-to-server) for now — straightforward, full repo:read scope.
// A future revision swaps to a GitHub App with installation tokens for
// finer-grained perms. Webhook delivery uses HMAC-SHA256 over the raw body
// keyed on GITHUB_WEBHOOK_SECRET.
//
// Sync surface per selected repo:
//   - Pull requests (open + closed, with merged_at)
//   - PR reviews
//   - Issues (filtered to exclude PR rows)
//   - Releases
//   - Recent commits on the default branch
//   - Workflow runs (CI state)
// Webhook surface: pull_request, pull_request_review, issues, release,
//   push, workflow_run.

const log = childLogger('integrations:github');

const AUTH_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

const SCOPES = ['repo', 'read:org'];

interface GithubTokens {
  access_token: string;
  scope?: string;
  token_type?: string;
  expires_at?: number;
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

async function ghGet<T>(tokens: GithubTokens, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${tokens.access_token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} ${String(res.status)}: ${text}`);
  }
  return JSON.parse(text) as T;
}

interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
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
  /** ISO timestamp; used for PR/issue/run since. */
  since?: string;
  /** Last commit sha we processed; used for commit feed. */
  last_sha?: string;
  /** Last release id we processed; used for releases. */
  last_release_id?: number;
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
  cursor: RepoCursor,
  ctx: SyncContext,
): Promise<RepoCursor> {
  const next: RepoCursor = { ...cursor };
  const sinceParam = cursor.since ?? new Date(0).toISOString();

  // ── PRs (open + closed) ─────────────────────────────────────────────
  for (const state of ['open', 'closed'] as const) {
    try {
      const prs = await ghGet<GhPullRequest[]>(
        tokens,
        `/repos/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`,
      );
      const filtered = prs.filter((p) => p.updated_at > sinceParam).slice(0, 50);
      if (filtered.length > 0) {
        await ctx.writeEvents(filtered.map((pr) => prToEvent(repo, pr)));
        for (const pr of filtered)
          if (!next.since || pr.updated_at > next.since) next.since = pr.updated_at;
        // Also fetch reviews for these PRs.
        for (const pr of filtered) {
          try {
            const reviews = await ghGet<GhReview[]>(
              tokens,
              `/repos/${repo}/pulls/${String(pr.number)}/reviews?per_page=50`,
            );
            const reviewEvents = reviews
              .map((r) => reviewToEvent(repo, pr.number, r))
              .filter((e): e is IntegrationEvent => e !== null);
            if (reviewEvents.length > 0) await ctx.writeEvents(reviewEvents);
          } catch (err) {
            log.debug({ err, repo, pr: pr.number }, 'fetching reviews failed');
          }
        }
      }
    } catch (err) {
      log.warn({ err, repo, state }, 'github PR fetch failed');
    }
  }

  // ── Issues ──────────────────────────────────────────────────────────
  try {
    const issues = await ghGet<GhIssue[]>(
      tokens,
      `/repos/${repo}/issues?state=all&since=${encodeURIComponent(sinceParam)}&sort=updated&direction=desc&per_page=50`,
    );
    const issueEvents = issues
      .map((i) => issueToEvent(repo, i))
      .filter((e): e is IntegrationEvent => e !== null);
    if (issueEvents.length > 0) {
      await ctx.writeEvents(issueEvents);
      for (const i of issues)
        if (!next.since || i.updated_at > next.since) next.since = i.updated_at;
    }
  } catch (err) {
    log.warn({ err, repo }, 'github issues fetch failed');
  }

  // ── Releases ────────────────────────────────────────────────────────
  try {
    const releases = await ghGet<GhRelease[]>(tokens, `/repos/${repo}/releases?per_page=30`);
    const lastSeen = cursor.last_release_id ?? 0;
    const newReleases = releases.filter((r) => r.id > lastSeen);
    if (newReleases.length > 0) {
      await ctx.writeEvents(newReleases.map((r) => releaseToEvent(repo, r)));
      next.last_release_id = Math.max(...releases.map((r) => r.id));
    }
  } catch (err) {
    log.warn({ err, repo }, 'github releases fetch failed');
  }

  // ── Recent commits on default branch ────────────────────────────────
  try {
    const meta = await ghGet<GhRepo>(tokens, `/repos/${repo}`);
    const commits = await ghGet<GhCommit[]>(
      tokens,
      `/repos/${repo}/commits?sha=${encodeURIComponent(meta.default_branch)}&per_page=30`,
    );
    const lastSha = cursor.last_sha;
    let newest: string | undefined;
    const fresh: GhCommit[] = [];
    for (const c of commits) {
      newest ??= c.sha;
      if (lastSha && c.sha === lastSha) break;
      fresh.push(c);
    }
    if (fresh.length > 0) {
      await ctx.writeEvents(fresh.map((c) => commitToEvent(repo, c)));
    }
    if (newest) next.last_sha = newest;
  } catch (err) {
    log.warn({ err, repo }, 'github commits fetch failed');
  }

  // ── Workflow runs ──────────────────────────────────────────────────
  try {
    const runs = await ghGet<{ workflow_runs: GhWorkflowRun[] }>(
      tokens,
      `/repos/${repo}/actions/runs?per_page=30`,
    );
    const filtered = runs.workflow_runs.filter((r) => r.updated_at > sinceParam);
    if (filtered.length > 0) {
      await ctx.writeEvents(filtered.map((r) => workflowRunToEvent(repo, r)));
      for (const r of filtered)
        if (!next.since || r.updated_at > next.since) next.since = r.updated_at;
    }
  } catch (err) {
    log.warn({ err, repo }, 'github workflow runs fetch failed');
  }

  return next;
}

export function verifyGithubSignature(body: string, signature: string | null): boolean {
  const env = getEnv();
  if (!env.GITHUB_WEBHOOK_SECRET || !signature) return false;
  const expected = `sha256=${createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex')}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
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
    const tokens: GithubTokens = {
      access_token: access,
      token_type: typeof body.token_type === 'string' ? body.token_type : 'Bearer',
      scope: typeof body.scope === 'string' ? body.scope : SCOPES.join(' '),
    };
    let login = 'github';
    let sub = '';
    try {
      const me = await ghGet<{ id: number; login: string }>(tokens, '/user');
      login = me.login;
      sub = String(me.id);
    } catch (err) {
      log.warn({ err }, 'failed to fetch GitHub /user');
    }
    return {
      externalAccountId: sub || `github-${Math.random().toString(36).slice(2, 10)}`,
      displayName: `GitHub — ${login}`,
      scopes: SCOPES,
      tokens: tokens as unknown as Record<string, unknown>,
    };
  },

  async listSyncableResources(_integration, tokens): Promise<ProviderResource[]> {
    const repos = await ghGet<GhRepo[]>(
      tokens as GithubTokens,
      '/user/repos?sort=updated&direction=desc&per_page=100',
    );
    return repos.map((r) => ({
      externalId: r.full_name,
      label: r.full_name + (r.private ? ' (private)' : ''),
      kind: 'github.repo',
    }));
  },

  async backfill({ tokens, selections, ctx }) {
    for (const sel of selections) {
      if (sel.kind !== 'github.repo') continue;
      try {
        const next = await syncRepo(tokens as GithubTokens, sel.externalId, {}, ctx);
        await ctx.saveCursor(`github.repo:${sel.externalId}`, next);
      } catch (err) {
        log.warn({ err, repo: sel.externalId }, 'github backfill failed for repo');
      }
    }
  },

  async incrementalSync({ tokens, selections, ctx }) {
    for (const sel of selections) {
      if (sel.kind !== 'github.repo') continue;
      const cursor = (await ctx.loadCursor(`github.repo:${sel.externalId}`)) as RepoCursor;
      try {
        const next = await syncRepo(tokens as GithubTokens, sel.externalId, cursor, ctx);
        await ctx.saveCursor(`github.repo:${sel.externalId}`, next);
      } catch (err) {
        log.warn({ err, repo: sel.externalId }, 'github incremental sync failed for repo');
      }
    }
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleWebhook({ payload }) {
    const p = payload as {
      action?: string;
      pull_request?: GhPullRequest;
      review?: GhReview;
      issue?: GhIssue;
      release?: GhRelease;
      workflow_run?: GhWorkflowRun;
      commits?: {
        id: string;
        url: string;
        message: string;
        timestamp: string;
        author?: { name?: string; email?: string; username?: string };
      }[];
      repository?: { full_name?: string };
      ref?: string;
    };
    const repo = p.repository?.full_name;
    if (!repo) return [];
    const events: IntegrationEvent[] = [];
    if (p.pull_request) events.push(prToEvent(repo, p.pull_request));
    if (p.review && p.pull_request) {
      const reviewEvent = reviewToEvent(repo, p.pull_request.number, p.review);
      if (reviewEvent) events.push(reviewEvent);
    }
    if (p.issue) {
      const evt = issueToEvent(repo, p.issue);
      if (evt) events.push(evt);
    }
    if (p.release) events.push(releaseToEvent(repo, p.release));
    if (p.workflow_run) events.push(workflowRunToEvent(repo, p.workflow_run));
    if (p.commits) {
      for (const c of p.commits) {
        events.push({
          dedupKey: `github:commit:${c.id}`,
          provider: 'github',
          externalObjectId: `${repo}#commit:${c.id}`,
          externalEventId: c.timestamp,
          eventType: 'commit.pushed',
          occurredAt: new Date(c.timestamp),
          actor: c.author
            ? {
                ...(c.author.username ? { externalId: c.author.username } : {}),
                ...(c.author.name ? { name: c.author.name } : {}),
                ...(c.author.email ? { email: c.author.email } : {}),
              }
            : null,
          contentText: `GitHub commit ${repo}@${c.id.slice(0, 7)} — ${c.message}`,
          extra: { github: { type: 'commit', repo, sha: c.id, url: c.url, ref: p.ref ?? null } },
        });
      }
    }
    return events;
  },
};
