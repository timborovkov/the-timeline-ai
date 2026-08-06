import { generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import type { SyncContext } from '#src/integrations/index.js';

import { resetEnvForTests } from '#src/env.js';
import { GithubRateLimitError, githubProvider } from '#src/integrations/providers/github.js';

const ENV_BACKUP = { ...process.env };

interface TestGithubCursor {
  prs_since?: string;
  issues_since?: string;
  issue_comments_since?: string;
  issue_comments_continuation?: {
    since: string;
    page: number;
    phase?: 'drain' | 'replay';
    max_updated_at?: string;
    expected_fingerprint?: string;
    scan_fingerprint?: string;
    replay_attempts?: number;
    replay_retry_at?: string;
    recovery_attempts?: number;
    recovery_retry_at?: string;
  };
  pr_review_comments_since?: string;
  pr_review_comments_continuation?: {
    since: string;
    page: number;
    phase?: 'drain' | 'replay';
    max_updated_at?: string;
    expected_fingerprint?: string;
    scan_fingerprint?: string;
    replay_attempts?: number;
    replay_retry_at?: string;
    recovery_attempts?: number;
    recovery_retry_at?: string;
  };
  releases_since?: string;
  workflow_runs_since?: string;
  last_sha?: string;
  commit_gap_target_sha?: string;
  commit_gap_high_water_sha?: string;
  commit_gap_until?: string;
  last_polled_at?: string;
  github_conditional?: Record<string, { etag?: string; lastModified?: string }>;
  issue_lifecycles?: Record<string, 'open' | 'closed'>;
  pr_lifecycles?: Record<string, 'open' | 'merged' | 'closed'>;
}

describe('githubProvider.startOAuth', () => {
  beforeEach(() => {
    process.env.GITHUB_APP_CLIENT_ID = 'client-id';
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
  });

  it('builds an OAuth authorize URL for the configured app', async () => {
    const result = await githubProvider.startOAuth({
      teamId: 'team-1',
      userId: 'user-1',
      redirectUri: 'https://timeline.test/api/integrations/github/callback',
      state: 'signed-state',
    });

    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://timeline.test/api/integrations/github/callback',
    );
    expect(url.searchParams.get('scope')).toBe('repo read:org');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('fails clearly when the app client id is missing', async () => {
    delete process.env.GITHUB_APP_CLIENT_ID;
    resetEnvForTests();

    await expect(
      githubProvider.startOAuth({
        teamId: 'team-1',
        userId: 'user-1',
        redirectUri: 'https://timeline.test/api/integrations/github/callback',
        state: 'signed-state',
      }),
    ).rejects.toThrow('GITHUB_APP_CLIENT_ID not configured');
  });
});

describe('githubProvider.handleOAuthCallback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GITHUB_APP_CLIENT_ID = 'client-id';
    process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
    resetEnvForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    vi.restoreAllMocks();
  });

  it('uses the deterministic E2E callback fixture without calling GitHub', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
    process.env.E2E_DETERMINISTIC_GITHUB_OAUTH = '1';
    resetEnvForTests();

    const result = await githubProvider.handleOAuthCallback({
      code: 'e2e-github-oauth-success',
      redirectUri: 'https://timeline.test/api/integrations/github/callback',
    });

    expect(result).toEqual({
      externalAccountId: 'e2e-github-user-42',
      displayName: 'GitHub - Timeline E2E',
      scopes: ['repo', 'read:org'],
      tokens: {
        access_token: 'e2e-github-access-token',
        token_type: 'Bearer',
        scope: 'repo read:org',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not use the deterministic E2E callback fixture in production', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'production path' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    globalThis.fetch = fetchMock;
    process.env.NODE_ENV = 'production';
    process.env.E2E_DETERMINISTIC_GITHUB_OAUTH = '1';
    process.env.AUTH_SECRET = 'test-auth-secret-at-least-sixteen-characters';
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    resetEnvForTests();

    await expect(
      githubProvider.handleOAuthCallback({
        code: 'e2e-github-oauth-success',
        redirectUri: 'https://timeline.test/api/integrations/github/callback',
      }),
    ).rejects.toThrow('GitHub 400');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('stores GitHub App installation metadata for later installation-token sync', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.origin + url.pathname === 'https://github.com/login/oauth/access_token') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'ghu_user',
              token_type: 'bearer',
              scope: 'repo,read:org',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.pathname === '/user') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 42, login: 'tim' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.pathname === '/user/installations') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              installations: [
                { id: 123, account: { login: 'acme', type: 'Organization' } },
                { id: 456, account: { login: 'tim', type: 'User' } },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message: 'unexpected' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchMock;

    const result = await githubProvider.handleOAuthCallback({
      code: 'code',
      redirectUri: 'https://timeline.test/api/integrations/github/callback',
    });

    expect(result).toMatchObject({
      externalAccountId: '42',
      displayName: 'GitHub — tim',
    });
    expect(result.tokens).toMatchObject({
      access_token: 'ghu_user',
      github_app_installations: [
        { id: '123', account_login: 'acme', account_type: 'Organization' },
        { id: '456', account_login: 'tim', account_type: 'User' },
      ],
    });
  });
});

describe('githubProvider.listSyncableResources', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('paginates accessible repos and returns github.repo selections', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (requestUrl.includes('/user/orgs')) {
        const page = new URL(requestUrl).searchParams.get('page');
        const body = page === '1' ? [{ id: 1, login: 'acme' }] : [];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      const page = new URL(requestUrl).searchParams.get('page');
      const body =
        page === '1'
          ? Array.from({ length: 100 }, (_, index) => ({
              id: index + 1,
              full_name: index === 0 ? 'acme/app' : `acme/repo-${String(index)}`,
              name: index === 0 ? 'app' : `repo-${String(index)}`,
              owner: { login: 'acme' },
              private: index === 0,
              default_branch: 'main',
            }))
          : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchMock;

    const resources = await githubProvider.listSyncableResources({} as never, {
      access_token: 'gho_token',
    });

    expect(resources).toHaveLength(101);
    expect(resources[0]).toEqual({
      externalId: 'acme',
      label: 'acme (all accessible repos)',
      kind: 'github.org',
    });
    expect(resources[1]).toEqual({
      externalId: 'acme/app',
      label: 'acme/app (private)',
      kind: 'github.repo',
    });
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] ?? [];
    const [secondUrl] = fetchMock.mock.calls[1] ?? [];
    expect(firstUrl).toBe('https://api.github.com/user/orgs?per_page=100&page=1');
    expect(firstInit?.headers).toMatchObject({ authorization: 'Bearer gho_token' });
    expect(secondUrl).toBe(
      'https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100&page=1',
    );
    const [thirdUrl] = fetchMock.mock.calls[2] ?? [];
    expect(thirdUrl).toBe(
      'https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100&page=2',
    );
  });

  it('surfaces GitHub primary rate limits with the provider retry time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:00:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: {
            'content-type': 'application/json',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Date.parse('2026-06-25T03:00:00.000Z') / 1000),
          },
        }),
      ),
    );
    globalThis.fetch = fetchMock;

    await expect(
      githubProvider.listSyncableResources({} as never, { access_token: 'gho_token' }),
    ).rejects.toMatchObject({
      code: 'github_rate_limited',
      retryAt: new Date('2026-06-25T03:00:00.000Z'),
      rateLimitKind: 'primary',
    });
    await expect(
      githubProvider.listSyncableResources({} as never, { access_token: 'gho_token' }),
    ).rejects.toBeInstanceOf(GithubRateLimitError);
    vi.useRealTimers();
  });
});

describe('githubProvider.handleWebhook', () => {
  it('normalizes pull request, issue, review, release, workflow, and push payloads', async () => {
    const baseRepo = {
      repository: { full_name: 'acme/app' },
    };
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);

    const pullRequestResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        action: 'opened',
        pull_request: {
          id: 7,
          number: 7,
          title: 'Add webhook ingestion',
          body: 'Webhook body',
          html_url: 'https://github.com/acme/app/pull/7',
          state: 'open',
          merged_at: null,
          updated_at: '2026-06-25T10:00:00Z',
          user: { login: 'alice' },
          base: { ref: 'main' },
          head: { ref: 'webhooks' },
        },
      },
    });
    const issueResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        action: 'opened',
        issue: {
          id: 8,
          number: 8,
          title: 'Bug report',
          body: null,
          html_url: 'https://github.com/acme/app/issues/8',
          state: 'open',
          updated_at: '2026-06-25T11:00:00Z',
          user: { login: 'bob' },
        },
      },
    });
    const reviewResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        action: 'submitted',
        pull_request: { number: 7 },
        review: {
          id: 9,
          body: 'Looks good',
          state: 'APPROVED',
          submitted_at: '2026-06-25T12:00:00Z',
          html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-9',
          user: { login: 'reviewer' },
        },
      },
    });
    const releaseResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        action: 'published',
        release: {
          id: 10,
          tag_name: 'v1.2.3',
          name: 'Release',
          body: null,
          html_url: 'https://github.com/acme/app/releases/tag/v1.2.3',
          draft: false,
          prerelease: false,
          published_at: '2026-06-25T13:00:00Z',
          created_at: '2026-06-25T12:55:00Z',
          author: { login: 'alice' },
        },
      },
    });
    const workflowResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        action: 'completed',
        workflow_run: {
          id: 11,
          name: 'CI',
          workflow_id: 1,
          run_number: 99,
          html_url: 'https://github.com/acme/app/actions/runs/11',
          status: 'completed',
          conclusion: 'success',
          updated_at: '2026-06-25T14:00:00Z',
          created_at: '2026-06-25T13:00:00Z',
          head_branch: 'main',
          head_sha: 'sha-001',
          event: 'push',
          actor: { login: 'alice' },
        },
      },
    });
    const pushResult = await handle({
      integration,
      payload: {
        ...baseRepo,
        commits: [
          {
            id: 'sha-abc',
            message: 'Ship webhook ingestion',
            timestamp: '2026-06-25T15:00:00Z',
            url: 'https://github.com/acme/app/commit/sha-abc',
            author: { name: 'Alice', email: 'alice@example.com', username: 'alice' },
          },
        ],
      },
    });
    const pullRequestEvents = normalize(pullRequestResult).events;
    const issueEvents = normalize(issueResult).events;
    const reviewEvents = normalize(reviewResult).events;
    const releaseEvents = normalize(releaseResult).events;
    const workflowEvents = normalize(workflowResult).events;
    const push = normalize(pushResult);
    const pushEvents = push.events;

    expect(pullRequestEvents[0]).toMatchObject({
      dedupKey: 'github:pr:7:open',
      eventType: 'pr.updated',
      objectMap: { type: 'task', externalId: 'acme/app#7' },
    });
    expect(issueEvents[0]).toMatchObject({
      dedupKey: 'github:issue:8:open',
      eventType: 'issue.updated',
      objectMap: { type: 'task', externalId: 'acme/app#issue:8' },
    });
    expect(reviewEvents[0]).toMatchObject({
      dedupKey: 'github:review:9:2026-06-25T12:00:00Z',
      eventType: 'pr.review.approved',
    });
    expect(releaseEvents[0]).toMatchObject({
      dedupKey: 'github:release:10:published:1316d0d21a1eb34a',
      eventType: 'release.published',
    });
    expect(workflowEvents[0]).toMatchObject({
      dedupKey: 'github:workflow_run:11:success:1',
      eventType: 'workflow_run.success',
    });
    expect(pushEvents[0]).toMatchObject({
      dedupKey: 'github:commit:sha-abc',
      eventType: 'commit.pushed',
    });
    expect(push.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'github.repo',
        externalId: 'acme/app',
        reason: 'github_repo_webhook',
      },
    ]);
  });

  it('keeps issue and PR dedup keys stable across same-lifecycle updated_at churn', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const baseRepo = {
      repository: { id: 1, full_name: 'acme/app', name: 'app', private: false },
    };

    const issueFirst = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T11:00:00Z',
            user: { login: 'bob' },
          },
        },
      }),
    ).events[0];
    const issueSecond = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report (edited)',
            body: 'more detail',
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T12:00:00Z',
            user: { login: 'bob' },
          },
        },
      }),
    ).events[0];
    const prFirst = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          pull_request: {
            id: 7,
            number: 7,
            title: 'Add webhook ingestion',
            body: 'Webhook body',
            html_url: 'https://github.com/acme/app/pull/7',
            state: 'open',
            merged_at: null,
            updated_at: '2026-06-25T10:00:00Z',
            user: { login: 'alice' },
            base: { ref: 'main' },
            head: { ref: 'webhooks' },
          },
        },
      }),
    ).events[0];
    const prSecond = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          pull_request: {
            id: 7,
            number: 7,
            title: 'Add webhook ingestion (edited)',
            body: 'Webhook body v2',
            html_url: 'https://github.com/acme/app/pull/7',
            state: 'open',
            merged_at: null,
            updated_at: '2026-06-25T10:30:00Z',
            user: { login: 'alice' },
            base: { ref: 'main' },
            head: { ref: 'webhooks' },
          },
        },
      }),
    ).events[0];

    expect(issueFirst?.dedupKey).toBe('github:issue:8:open');
    expect(issueSecond?.dedupKey).toBe(issueFirst?.dedupKey);
    expect(prFirst?.dedupKey).toBe('github:pr:7:open');
    expect(prSecond?.dedupKey).toBe(prFirst?.dedupKey);
    expect(issueSecond?.contentText).toContain('edited');
    expect(prSecond?.contentText).toContain('edited');
  });

  it('mints a new issue dedup key when a closed issue is reopened', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const baseRepo = {
      repository: { id: 1, full_name: 'acme/app', name: 'app', private: false },
    };
    const opened = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'opened',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T11:00:00Z',
            user: { login: 'bob' },
          },
        },
      }),
    ).events[0];
    const closed = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'closed',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'closed',
            updated_at: '2026-06-25T12:00:00Z',
            user: { login: 'bob' },
          },
        },
      }),
    ).events[0];
    const reopened = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'reopened',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T13:00:00Z',
            user: { login: 'bob' },
          },
        },
      }),
    ).events[0];

    expect(opened?.dedupKey).toBe('github:issue:8:open');
    expect(closed?.dedupKey).toBe('github:issue:8:closed:2026-06-25T12:00:00Z');
    expect(reopened?.dedupKey).toBe('github:issue:8:open:2026-06-25T13:00:00Z');
    expect(reopened?.dedupKey).not.toBe(opened?.dedupKey);
    expect(reopened?.eventType).toBe('issue.reopened');
  });

  it('mints a new release dedup key when published release notes change', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const baseRepo = {
      repository: { id: 1, full_name: 'acme/app', name: 'app', private: false },
    };
    const releaseBase = {
      id: 10,
      tag_name: 'v1.2.3',
      name: 'Release',
      html_url: 'https://github.com/acme/app/releases/tag/v1.2.3',
      draft: false,
      prerelease: false,
      published_at: '2026-06-25T13:00:00Z',
      created_at: '2026-06-25T12:55:00Z',
      author: { login: 'alice' },
    };
    const published = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'published',
          release: { ...releaseBase, body: null },
        },
      }),
    ).events[0];
    const edited = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          release: {
            ...releaseBase,
            body: 'fixed notes',
            updated_at: '2026-06-25T14:00:00Z',
          },
        },
      }),
    ).events[0];
    const replay = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'edited',
          release: {
            ...releaseBase,
            body: 'fixed notes',
            updated_at: '2026-06-25T14:00:00Z',
          },
        },
      }),
    ).events[0];

    expect(published?.dedupKey).toBe('github:release:10:published:1316d0d21a1eb34a');
    expect(edited?.dedupKey).toBe('github:release:10:published:d73eaaa03f1ca43d');
    expect(edited?.dedupKey).not.toBe(published?.dedupKey);
    expect(replay?.dedupKey).toBe(edited?.dedupKey);
    expect(edited?.contentText).toContain('fixed notes');
  });

  it('mints a new workflow-run dedup key for each run_attempt with the same conclusion', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const baseRepo = {
      repository: { id: 1, full_name: 'acme/app', name: 'app', private: false },
    };
    const runBase = {
      id: 11,
      name: 'CI',
      workflow_id: 1,
      run_number: 99,
      html_url: 'https://github.com/acme/app/actions/runs/11',
      status: 'completed',
      conclusion: 'failure',
      created_at: '2026-06-25T13:00:00Z',
      head_branch: 'main',
      head_sha: 'sha-001',
      event: 'push',
      actor: { login: 'alice' },
    };
    const attempt1 = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'completed',
          workflow_run: {
            ...runBase,
            run_attempt: 1,
            updated_at: '2026-06-25T14:00:00Z',
          },
        },
      }),
    ).events[0];
    const attempt3 = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'completed',
          workflow_run: {
            ...runBase,
            run_attempt: 3,
            updated_at: '2026-06-25T16:00:00Z',
          },
        },
      }),
    ).events[0];
    const attempt3Replay = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'completed',
          workflow_run: {
            ...runBase,
            run_attempt: 3,
            updated_at: '2026-06-25T16:00:00Z',
          },
        },
      }),
    ).events[0];

    expect(attempt1?.dedupKey).toBe('github:workflow_run:11:failure:1');
    expect(attempt3?.dedupKey).toBe('github:workflow_run:11:failure:3');
    expect(attempt3?.dedupKey).not.toBe(attempt1?.dedupKey);
    expect(attempt3Replay?.dedupKey).toBe(attempt3?.dedupKey);
    expect(attempt3?.contentText).toContain('attempt 3');
  });

  it('renders issue comments, review summaries, and inline review comments with parent evidence', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const baseRepo = { repository: { full_name: 'acme/app' } };
    const pullRequest = {
      id: 7,
      number: 7,
      title: 'Conversation fidelity',
      body: 'PR description remains captured',
      html_url: 'https://github.com/acme/app/pull/7',
      state: 'open',
      merged_at: null,
      updated_at: '2026-06-25T10:00:00Z',
      user: { login: 'author' },
      base: { ref: 'main' },
      head: { ref: 'conversation-content' },
    };

    const issueComment = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'created',
          issue: {
            id: 8,
            number: 8,
            title: 'Conversation issue',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T10:01:00Z',
            user: { login: 'author' },
          },
          comment: {
            id: 101,
            body: 'Issue comment body',
            html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
            issue_url: 'https://api.github.com/repos/acme/app/issues/8',
            created_at: '2026-06-25T10:01:00Z',
            updated_at: '2026-06-25T10:02:00Z',
            user: { login: 'commenter' },
          },
        },
      }),
    ).events.find((event) => event.eventType === 'issue_comment.created');
    const review = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'submitted',
          pull_request: pullRequest,
          review: {
            id: 102,
            body: 'Review summary body',
            state: 'APPROVED',
            submitted_at: '2026-06-25T10:03:00Z',
            html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-102',
            pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
            user: { login: 'reviewer' },
          },
        },
      }),
    ).events.find((event) => event.eventType === 'pr.review.approved');
    const inlineComment = normalize(
      await handle({
        integration,
        payload: {
          ...baseRepo,
          action: 'created',
          pull_request: pullRequest,
          comment: {
            id: 103,
            body: 'Inline review comment body',
            html_url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
            pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
            path: 'src/conversation.ts',
            line: 42,
            created_at: '2026-06-25T10:04:00Z',
            updated_at: '2026-06-25T10:05:00Z',
            user: { login: 'inline-reviewer' },
          },
        },
      }),
    ).events.find((event) => event.eventType === 'pr.review_comment.created');

    expect(issueComment).toMatchObject({
      actor: { externalId: 'commenter', name: 'commenter' },
      occurredAt: new Date('2026-06-25T10:02:00Z'),
      extra: {
        github: {
          type: 'issue_comment',
          body: 'Issue comment body',
          author: { login: 'commenter' },
          url: 'https://github.com/acme/app/issues/8#issuecomment-101',
          created_at: '2026-06-25T10:01:00Z',
          updated_at: '2026-06-25T10:02:00Z',
          parent: {
            type: 'issue',
            external_id: 'acme/app#issue:8',
            url: 'https://github.com/acme/app/issues/8',
          },
        },
      },
    });
    expect(issueComment?.contentText).toContain('Issue comment body');
    expect(issueComment?.contentText).toContain('@commenter');
    expect(issueComment?.contentText).toContain('acme/app#8');
    expect(issueComment?.contentText).toContain('https://github.com/acme/app/issues/8');
    expect(issueComment?.contentText).toContain('2026-06-25T10:02:00Z');

    expect(review).toMatchObject({
      actor: { externalId: 'reviewer', name: 'reviewer' },
      occurredAt: new Date('2026-06-25T10:03:00Z'),
      extra: {
        github: {
          type: 'review',
          body: 'Review summary body',
          author: { login: 'reviewer' },
          url: 'https://github.com/acme/app/pull/7#pullrequestreview-102',
          submitted_at: '2026-06-25T10:03:00Z',
          parent: {
            type: 'pull_request',
            external_id: 'acme/app#7',
            url: 'https://github.com/acme/app/pull/7',
          },
        },
      },
    });
    expect(review?.contentText).toContain('Review summary body');
    expect(review?.contentText).toContain('@reviewer');
    expect(review?.contentText).toContain('acme/app#7');
    expect(review?.contentText).toContain('https://github.com/acme/app/pull/7');
    expect(review?.contentText).toContain('2026-06-25T10:03:00Z');

    expect(inlineComment).toMatchObject({
      actor: { externalId: 'inline-reviewer', name: 'inline-reviewer' },
      occurredAt: new Date('2026-06-25T10:05:00Z'),
      extra: {
        github: {
          type: 'review_comment',
          body: 'Inline review comment body',
          author: { login: 'inline-reviewer' },
          url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
          created_at: '2026-06-25T10:04:00Z',
          updated_at: '2026-06-25T10:05:00Z',
          parent: {
            type: 'pull_request',
            external_id: 'acme/app#7',
            url: 'https://github.com/acme/app/pull/7',
          },
        },
      },
    });
    expect(inlineComment?.contentText).toContain('Inline review comment body');
    expect(inlineComment?.contentText).toContain('@inline-reviewer');
    expect(inlineComment?.contentText).toContain('acme/app#7');
    expect(inlineComment?.contentText).toContain('https://github.com/acme/app/pull/7');
    expect(inlineComment?.contentText).toContain('2026-06-25T10:05:00Z');
  });

  it('captures bodyless deleted comments without fabricating prior source content', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const result = await handle({
      integration,
      payload: {
        repository: { full_name: 'acme/app' },
        action: 'deleted',
        issue: {
          id: 8,
          number: 8,
          title: 'Conversation issue',
          body: null,
          html_url: 'https://github.com/acme/app/issues/8',
          state: 'open',
          updated_at: '2026-06-25T10:06:00Z',
          user: { login: 'author' },
        },
        comment: {
          id: 101,
          body: null,
          html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
          issue_url: 'https://api.github.com/repos/acme/app/issues/8',
          created_at: '2026-06-25T10:01:00Z',
          updated_at: '2026-06-25T10:06:00Z',
          user: { login: 'commenter' },
        },
      },
    });
    const events = Array.isArray(result) ? result : result.events;
    const deleted = events.find((event) => event.eventType === 'issue_comment.deleted');

    expect(deleted).toMatchObject({
      extra: { github: { body: null, updated_at: '2026-06-25T10:06:00Z' } },
    });
    expect(deleted?.contentText).toContain('[body unavailable]');
    expect(deleted?.contentText).not.toContain('Issue comment body');
  });

  it('keeps same-second comment webhook transitions distinct while replaying each action', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const sameSecond = '2026-06-25T10:06:00Z';
    const actions = ['created', 'edited', 'deleted'] as const;
    const eventFor = async (payload: Record<string, unknown>, eventType: string) => {
      const result = await handle({ integration, payload });
      const events = Array.isArray(result) ? result : result.events;
      return events.find((event) => event.eventType === eventType);
    };
    const issuePayload = (action: (typeof actions)[number]) => ({
      repository: { full_name: 'acme/app' },
      action,
      issue: {
        id: 8,
        number: 8,
        title: 'Conversation issue',
        body: null,
        html_url: 'https://github.com/acme/app/issues/8',
        state: 'open',
        updated_at: sameSecond,
        user: { login: 'author' },
      },
      comment: {
        id: 101,
        body: action === 'deleted' ? null : 'Issue comment body',
        html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
        issue_url: 'https://api.github.com/repos/acme/app/issues/8',
        created_at: sameSecond,
        updated_at: sameSecond,
        user: { login: 'commenter' },
      },
    });
    const reviewPayload = (action: (typeof actions)[number]) => ({
      repository: { full_name: 'acme/app' },
      action,
      pull_request: {
        id: 7,
        number: 7,
        title: 'Conversation PR',
        body: null,
        html_url: 'https://github.com/acme/app/pull/7',
        state: 'open',
        merged_at: null,
        updated_at: sameSecond,
        user: { login: 'author' },
        base: { ref: 'main' },
        head: { ref: 'conversation-content' },
      },
      comment: {
        id: 103,
        body: action === 'deleted' ? null : 'Inline review comment body',
        html_url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
        pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
        created_at: sameSecond,
        updated_at: sameSecond,
        user: { login: 'reviewer' },
      },
    });

    const issueEvents = await Promise.all(
      actions.map((action) =>
        eventFor(issuePayload(action), `issue_comment.${action === 'edited' ? 'updated' : action}`),
      ),
    );
    const reviewEvents = await Promise.all(
      actions.map((action) =>
        eventFor(
          reviewPayload(action),
          `pr.review_comment.${action === 'edited' ? 'updated' : action}`,
        ),
      ),
    );
    const issueReplay = await eventFor(issuePayload('created'), 'issue_comment.created');
    const reviewReplay = await eventFor(reviewPayload('created'), 'pr.review_comment.created');

    expect(issueEvents[0]?.dedupKey).toMatch(
      new RegExp(`^github:issue_comment:101:${sameSecond}:state:[a-f0-9]{64}$`),
    );
    expect(issueEvents[1]?.dedupKey).toBe(issueEvents[0]?.dedupKey);
    expect(issueEvents[2]?.dedupKey).toMatch(
      new RegExp(`^github:issue_comment:101:${sameSecond}:state:[a-f0-9]{64}$`),
    );
    expect(issueEvents[2]?.dedupKey).not.toBe(issueEvents[0]?.dedupKey);
    expect(reviewEvents[0]?.dedupKey).toMatch(
      new RegExp(`^github:review_comment:103:${sameSecond}:state:[a-f0-9]{64}$`),
    );
    expect(reviewEvents[1]?.dedupKey).toBe(reviewEvents[0]?.dedupKey);
    expect(reviewEvents[2]?.dedupKey).toMatch(
      new RegExp(`^github:review_comment:103:${sameSecond}:state:[a-f0-9]{64}$`),
    );
    expect(reviewEvents[2]?.dedupKey).not.toBe(reviewEvents[0]?.dedupKey);
    expect(issueReplay?.dedupKey).toBe(issueEvents[0]?.dedupKey);
    expect(reviewReplay?.dedupKey).toBe(reviewEvents[0]?.dedupKey);
  });

  it('keeps distinct same-second edited comment states while replaying each revision', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const sameSecond = '2026-06-25T10:06:00Z';
    const eventFor = async (payload: Record<string, unknown>, eventType: string) => {
      const result = await handle({ integration, payload });
      const events = Array.isArray(result) ? result : result.events;
      return events.find((event) => event.eventType === eventType);
    };
    const issuePayload = (body: string) => ({
      repository: { full_name: 'acme/app' },
      action: 'edited',
      issue: {
        id: 8,
        number: 8,
        title: 'Conversation issue',
        body: null,
        html_url: 'https://github.com/acme/app/issues/8',
        state: 'open',
        updated_at: sameSecond,
        user: { login: 'author' },
      },
      comment: {
        id: 101,
        body,
        html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
        issue_url: 'https://api.github.com/repos/acme/app/issues/8',
        created_at: '2026-06-25T10:00:00Z',
        updated_at: sameSecond,
        user: { login: 'commenter' },
      },
    });
    const reviewPayload = (body: string) => ({
      repository: { full_name: 'acme/app' },
      action: 'edited',
      pull_request: {
        id: 7,
        number: 7,
        title: 'Conversation PR',
        body: null,
        html_url: 'https://github.com/acme/app/pull/7',
        state: 'open',
        merged_at: null,
        updated_at: sameSecond,
        user: { login: 'author' },
        base: { ref: 'main' },
        head: { ref: 'conversation-content' },
      },
      comment: {
        id: 103,
        body,
        html_url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
        pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
        created_at: '2026-06-25T10:00:00Z',
        updated_at: sameSecond,
        user: { login: 'reviewer' },
      },
    });

    const [issueFirst, issueSecond, issueReplay, reviewFirst, reviewSecond, reviewReplay] =
      await Promise.all([
        eventFor(issuePayload('First issue edit'), 'issue_comment.updated'),
        eventFor(issuePayload('Second issue edit'), 'issue_comment.updated'),
        eventFor(issuePayload('First issue edit'), 'issue_comment.updated'),
        eventFor(reviewPayload('First review edit'), 'pr.review_comment.updated'),
        eventFor(reviewPayload('Second review edit'), 'pr.review_comment.updated'),
        eventFor(reviewPayload('First review edit'), 'pr.review_comment.updated'),
      ]);

    expect(issueFirst?.dedupKey).not.toBe(issueSecond?.dedupKey);
    expect(issueReplay?.dedupKey).toBe(issueFirst?.dedupKey);
    expect(reviewFirst?.dedupKey).not.toBe(reviewSecond?.dedupKey);
    expect(reviewReplay?.dedupKey).toBe(reviewFirst?.dedupKey);
  });

  it('preserves collaboration context for GitHub work items and renders it for search', async () => {
    const integration = { id: 'integration-1', teamId: 'team-1' } as never;
    const handle = githubProvider.handleWebhook?.bind(githubProvider);
    if (!handle) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);

    const populated = normalize(
      await handle({
        integration,
        payload: {
          repository: { full_name: 'acme/app' },
          action: 'assigned',
          pull_request: {
            id: 7,
            number: 7,
            title: 'Add webhook ingestion',
            body: 'Webhook body',
            html_url: 'https://github.com/acme/app/pull/7',
            state: 'open',
            merged_at: null,
            updated_at: '2026-06-25T10:00:00Z',
            user: { login: 'alice' },
            assignees: [
              { id: 101, login: 'octo-alice' },
              { id: 102, login: 'octo-bob' },
            ],
            labels: [
              { id: 201, name: 'backend' },
              { id: 202, name: 'needs-triage' },
            ],
            milestone: { id: 301, number: 4, title: 'First release', state: 'open' },
            base: { ref: 'main' },
            head: { ref: 'webhooks' },
          },
        },
      }),
    ).events[0];

    const empty = normalize(
      await handle({
        integration,
        payload: {
          repository: { full_name: 'acme/app' },
          action: 'edited',
          issue: {
            id: 8,
            number: 8,
            title: 'Bug report',
            body: null,
            html_url: 'https://github.com/acme/app/issues/8',
            state: 'open',
            updated_at: '2026-06-25T11:00:00Z',
            user: { login: 'bob' },
            assignees: [],
            labels: [],
            milestone: null,
          },
        },
      }),
    ).events[0];

    expect(populated).toMatchObject({
      extra: {
        github: {
          assignees: [
            { id: '101', login: 'octo-alice' },
            { id: '102', login: 'octo-bob' },
          ],
          labels: [
            { id: '201', name: 'backend' },
            { id: '202', name: 'needs-triage' },
          ],
          milestone: { id: '301', number: 4, title: 'First release', state: 'open' },
        },
      },
    });
    expect(populated?.contentText).toContain('Assignees: @octo-alice, @octo-bob');
    expect(populated?.contentText).toContain('Labels: backend, needs-triage');
    expect(populated?.contentText).toContain('Milestone: First release (open)');
    expect(empty).toMatchObject({
      extra: { github: { assignees: [], labels: [], milestone: null } },
    });
    expect(empty?.contentText).not.toMatch(/Assignees:|Labels:|Milestone:/u);
  });
});

describe('githubProvider.backfill', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('normalizes REST work-item collaboration context into metadata and searchable text', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              full_name: 'acme/app',
              name: 'app',
              owner: { login: 'acme' },
              private: true,
              default_branch: 'main',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.pathname.endsWith('/pulls')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url.searchParams.get('state') === 'open'
                ? [
                    {
                      id: 7,
                      number: 7,
                      title: 'Backfill PR',
                      body: null,
                      html_url: 'https://github.com/acme/app/pull/7',
                      state: 'open',
                      merged_at: null,
                      updated_at: '2026-06-25T10:00:00Z',
                      user: { login: 'alice' },
                      assignees: [{ id: 101, login: 'octo-alice' }],
                      labels: [{ id: 201, name: 'backend' }],
                      milestone: { id: 301, number: 4, title: 'First release', state: 'open' },
                      base: { ref: 'main' },
                      head: { ref: 'backfill' },
                    },
                  ]
                : [],
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.pathname.endsWith('/pulls/7/reviews')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.pathname.endsWith('/issues')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 8,
                number: 8,
                title: 'Backfill issue',
                body: null,
                html_url: 'https://github.com/acme/app/issues/8',
                state: 'open',
                updated_at: '2026-06-25T11:00:00Z',
                user: { login: 'bob' },
                assignees: [{ id: 102, login: 'octo-bob' }],
                labels: [{ id: 202, name: 'needs-triage' }],
                milestone: { id: 302, number: 5, title: 'Bug bash', state: 'closed' },
              },
              {
                id: 9,
                number: 9,
                title: 'Backfill issue without collaboration context',
                body: null,
                html_url: 'https://github.com/acme/app/issues/9',
                state: 'open',
                updated_at: '2026-06-25T12:00:00Z',
                user: { login: 'carol' },
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.pathname.endsWith('/issues/comments')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.pathname.endsWith('/pulls/comments')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.pathname.endsWith('/releases') || url.pathname.endsWith('/commits')) {
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (url.pathname.endsWith('/actions/runs')) {
        return Promise.resolve(
          new Response(JSON.stringify({ workflow_runs: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ message: 'unexpected' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    await githubProvider.backfill({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit,
        saveCursor: vi.fn(),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    const pr = events.find((event) => event.eventType === 'pr.updated');
    const issue = events.find((event) => event.eventType === 'issue.updated');
    const missingIssue = events.find((event) => event.externalObjectId === 'acme/app#issue:9');
    expect(pr).toMatchObject({
      extra: {
        github: {
          assignees: [{ id: '101', login: 'octo-alice' }],
          labels: [{ id: '201', name: 'backend' }],
          milestone: { id: '301', number: 4, title: 'First release', state: 'open' },
        },
      },
    });
    expect(pr?.contentText).toContain('Assignees: @octo-alice');
    expect(pr?.contentText).toContain('Labels: backend');
    expect(pr?.contentText).toContain('Milestone: First release (open)');
    expect(issue).toMatchObject({
      extra: {
        github: {
          assignees: [{ id: '102', login: 'octo-bob' }],
          labels: [{ id: '202', name: 'needs-triage' }],
          milestone: { id: '302', number: 5, title: 'Bug bash', state: 'closed' },
        },
      },
    });
    expect(issue?.contentText).toContain('Assignees: @octo-bob');
    expect(issue?.contentText).toContain('Labels: needs-triage');
    expect(issue?.contentText).toContain('Milestone: Bug bash (closed)');
    expect(missingIssue).toMatchObject({
      extra: { github: { assignees: [], labels: [], milestone: null } },
    });
    expect(missingIssue?.contentText).not.toMatch(/Assignees:|Labels:|Milestone:/u);
    expect(
      fetchMock.mock.calls.map(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname;
      }),
    ).toEqual(
      expect.arrayContaining(['/repos/acme/app/issues/comments', '/repos/acme/app/pulls/comments']),
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('githubProvider selected-repository conversation sync', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  for (const mode of ['backfill', 'incremental'] as const) {
    it(`${mode}s issue comments, review summaries, and inline review comments with parent evidence`, async () => {
      const jsonResponse = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      const fetchMock = vi.fn<typeof fetch>((input) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        if (url.pathname === '/repos/acme/app/pulls') {
          return Promise.resolve(
            jsonResponse(
              url.searchParams.get('state') === 'open'
                ? [
                    {
                      id: 7,
                      number: 7,
                      title: 'Conversation fidelity',
                      body: 'PR description remains captured',
                      html_url: 'https://github.com/acme/app/pull/7',
                      state: 'open',
                      merged_at: null,
                      updated_at: '2026-06-25T10:00:00Z',
                      user: { login: 'author' },
                      base: { ref: 'main' },
                      head: { ref: 'conversation-content' },
                    },
                  ]
                : [],
            ),
          );
        }
        if (url.pathname === '/repos/acme/app/pulls/7/reviews') {
          return Promise.resolve(
            jsonResponse([
              {
                id: 102,
                body: 'Review summary body',
                state: 'APPROVED',
                submitted_at: '2026-06-25T10:03:00Z',
                html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-102',
                pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
                user: { login: 'reviewer' },
              },
            ]),
          );
        }
        if (url.pathname === '/repos/acme/app/issues') return Promise.resolve(jsonResponse([]));
        if (url.pathname === '/repos/acme/app/issues/comments') {
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                body: 'Issue comment body',
                html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
                issue_url: 'https://api.github.com/repos/acme/app/issues/8',
                created_at: '2026-06-25T10:01:00Z',
                updated_at: '2026-06-25T10:02:00Z',
                user: { login: 'commenter' },
              },
            ]),
          );
        }
        if (url.pathname === '/repos/acme/app/pulls/comments') {
          return Promise.resolve(
            jsonResponse([
              {
                id: 103,
                body: 'Inline review comment body',
                html_url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
                pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
                path: 'src/conversation.ts',
                line: 42,
                created_at: '2026-06-25T10:04:00Z',
                updated_at: '2026-06-25T10:05:00Z',
                user: { login: 'inline-reviewer' },
              },
            ]),
          );
        }
        if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
        if (url.pathname === '/repos/acme/app/releases') return Promise.resolve(jsonResponse([]));
        if (url.pathname === '/repos/acme/app/actions/runs') {
          return Promise.resolve(jsonResponse({ workflow_runs: [] }));
        }
        return Promise.resolve(jsonResponse({ message: 'unexpected' }));
      });
      globalThis.fetch = fetchMock;
      const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
      const saveCursor = vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined);
      const input = {
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents,
          recordAudit: vi.fn(),
          saveCursor,
          loadCursor: vi.fn().mockResolvedValue({}),
          persistTokens: vi.fn(),
        },
      };

      if (mode === 'backfill') await githubProvider.backfill(input);
      else await githubProvider.incrementalSync(input);

      const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
      const issueComment = events.find((event) => event.eventType === 'issue_comment.updated');
      const review = events.find((event) => event.eventType === 'pr.review.approved');
      const inlineComment = events.find((event) => event.eventType === 'pr.review_comment.updated');

      expect(issueComment).toMatchObject({
        actor: { externalId: 'commenter', name: 'commenter' },
        occurredAt: new Date('2026-06-25T10:02:00Z'),
        extra: {
          github: {
            type: 'issue_comment',
            body: 'Issue comment body',
            author: { login: 'commenter' },
            url: 'https://github.com/acme/app/issues/8#issuecomment-101',
            created_at: '2026-06-25T10:01:00Z',
            updated_at: '2026-06-25T10:02:00Z',
            parent: {
              type: 'issue',
              external_id: 'acme/app#issue:8',
              url: 'https://github.com/acme/app/issues/8',
            },
          },
        },
      });
      expect(issueComment?.contentText).toContain('Issue comment body');
      expect(issueComment?.contentText).toContain('@commenter');
      expect(issueComment?.contentText).toContain('acme/app#8');
      expect(issueComment?.contentText).toContain('https://github.com/acme/app/issues/8');
      expect(issueComment?.contentText).toContain('2026-06-25T10:02:00Z');

      expect(review).toMatchObject({
        actor: { externalId: 'reviewer', name: 'reviewer' },
        occurredAt: new Date('2026-06-25T10:03:00Z'),
        extra: {
          github: {
            type: 'review',
            body: 'Review summary body',
            author: { login: 'reviewer' },
            url: 'https://github.com/acme/app/pull/7#pullrequestreview-102',
            submitted_at: '2026-06-25T10:03:00Z',
            parent: {
              type: 'pull_request',
              external_id: 'acme/app#7',
              url: 'https://github.com/acme/app/pull/7',
            },
          },
        },
      });
      expect(review?.contentText).toContain('Review summary body');
      expect(review?.contentText).toContain('@reviewer');
      expect(review?.contentText).toContain('acme/app#7');
      expect(review?.contentText).toContain('https://github.com/acme/app/pull/7');
      expect(review?.contentText).toContain('2026-06-25T10:03:00Z');

      expect(inlineComment).toMatchObject({
        actor: { externalId: 'inline-reviewer', name: 'inline-reviewer' },
        occurredAt: new Date('2026-06-25T10:05:00Z'),
        extra: {
          github: {
            type: 'review_comment',
            body: 'Inline review comment body',
            author: { login: 'inline-reviewer' },
            url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
            created_at: '2026-06-25T10:04:00Z',
            updated_at: '2026-06-25T10:05:00Z',
            parent: {
              type: 'pull_request',
              external_id: 'acme/app#7',
              url: 'https://github.com/acme/app/pull/7',
            },
          },
        },
      });
      expect(inlineComment?.contentText).toContain('Inline review comment body');
      expect(inlineComment?.contentText).toContain('@inline-reviewer');
      expect(inlineComment?.contentText).toContain('acme/app#7');
      expect(inlineComment?.contentText).toContain('https://github.com/acme/app/pull/7');
      expect(inlineComment?.contentText).toContain('2026-06-25T10:05:00Z');

      expect(saveCursor.mock.calls.map(([resourceType]) => resourceType)).toEqual(
        expect.arrayContaining([
          'github.repo:acme/app:issue_comments',
          'github.repo:acme/app:pr_review_comments',
        ]),
      );
    });
  }
});

describe('githubProvider.incrementalSync', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function jsonResponse(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  function savedCursor(
    saveCursor: ReturnType<typeof vi.fn>,
    resourceType: string,
  ): TestGithubCursor | undefined {
    return saveCursor.mock.calls.find(
      ([savedResourceType]) => savedResourceType === resourceType,
    )?.[1] as TestGithubCursor | undefined;
  }

  function savedStatus(
    saveCursor: ReturnType<typeof vi.fn>,
    resourceType: string,
  ): { lastStatus?: string; lastError?: string | null } | undefined {
    return saveCursor.mock.calls.find(
      ([savedResourceType]) => savedResourceType === resourceType,
    )?.[2] as { lastStatus?: string; lastError?: string | null } | undefined;
  }

  function commit(index: number): {
    sha: string;
    html_url: string;
    commit: {
      author: { name: string; email: string; date: string };
      committer: { name: string; email: string; date: string };
      message: string;
    };
    author: { login: string };
  } {
    return {
      sha: `sha-${String(index).padStart(3, '0')}`,
      html_url: `https://github.com/acme/app/commit/${String(index)}`,
      commit: {
        author: {
          name: 'Alice',
          email: 'alice@example.com',
          date: `2026-06-10T10:${String(index % 60).padStart(2, '0')}:00Z`,
        },
        committer: {
          name: 'Alice',
          email: 'alice@example.com',
          date: `2026-06-10T10:${String(index % 60).padStart(2, '0')}:00Z`,
        },
        message: `Commit ${String(index)}`,
      },
      author: { login: 'alice' },
    };
  }

  function pullRequest(): {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: 'open';
    merged_at: string | null;
    updated_at: string;
    user: { login: string };
    base: { ref: string };
    head: { ref: string };
  } {
    return {
      id: 7,
      number: 7,
      title: 'Add polling',
      body: null,
      html_url: 'https://github.com/acme/app/pull/7',
      state: 'open',
      merged_at: null,
      updated_at: '2026-06-10T11:00:00Z',
      user: { login: 'alice' },
      base: { ref: 'main' },
      head: { ref: 'polling' },
    };
  }

  function issueRow(
    index: number,
    isPullRequest = false,
  ): {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: 'open';
    updated_at: string;
    user: { login: string };
    pull_request?: { html_url: string };
  } {
    return {
      id: index,
      number: index,
      title: isPullRequest ? 'PR row from issues endpoint' : 'Issue row',
      body: null,
      html_url: `https://github.com/acme/app/issues/${String(index)}`,
      state: 'open',
      updated_at: `2026-06-10T13:${String(index % 60).padStart(2, '0')}:00Z`,
      user: { login: 'alice' },
      ...(isPullRequest
        ? { pull_request: { html_url: `https://github.com/acme/app/pull/${String(index)}` } }
        : {}),
    };
  }

  function review(index: number): {
    id: number;
    body: string | null;
    state: string;
    submitted_at: string;
    user: { login: string };
    html_url: string;
  } {
    return {
      id: index,
      body: `Review ${String(index)}`,
      state: 'APPROVED',
      submitted_at: `2026-06-10T11:${String(index % 60).padStart(2, '0')}:00Z`,
      user: { login: 'reviewer' },
      html_url: `https://github.com/acme/app/pull/7#pullrequestreview-${String(index)}`,
    };
  }

  function release(
    id: number,
    publishedAt: string | null,
  ): {
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
  } {
    return {
      id,
      tag_name: `v${String(id)}`,
      name: null,
      body: null,
      html_url: `https://github.com/acme/app/releases/tag/v${String(id)}`,
      draft: publishedAt === null,
      prerelease: false,
      published_at: publishedAt,
      created_at: '2026-06-01T00:00:00Z',
      author: { login: 'alice' },
    };
  }

  function workflowRun(
    id: number,
    updatedAt: string,
    extras: { conclusion?: string | null; run_attempt?: number } = {},
  ): {
    id: number;
    name: string | null;
    workflow_id: number;
    run_number: number;
    run_attempt: number;
    html_url: string;
    status: string | null;
    conclusion: string | null;
    updated_at: string;
    head_branch: string | null;
    head_sha: string;
    event: string;
    actor: { login: string } | null;
  } {
    return {
      id,
      name: 'CI',
      workflow_id: 1,
      run_number: id,
      run_attempt: extras.run_attempt ?? 1,
      html_url: `https://github.com/acme/app/actions/runs/${String(id)}`,
      status: 'completed',
      conclusion: extras.conclusion === undefined ? 'success' : extras.conclusion,
      updated_at: updatedAt,
      head_branch: 'main',
      head_sha: `sha-${String(id)}`,
      event: 'push',
      actor: { login: 'alice' },
    };
  }

  function emptyGithubFetch(input: string | URL | Request): Response | undefined {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(requestUrl);
    if (url.pathname.endsWith('/pulls')) return jsonResponse([]);
    if (url.pathname.endsWith('/issues')) return jsonResponse([]);
    if (url.pathname.endsWith('/issues/comments')) return jsonResponse([]);
    if (url.pathname.endsWith('/pulls/comments')) return jsonResponse([]);
    if (url.pathname.endsWith('/releases')) return jsonResponse([]);
    if (url.pathname.endsWith('/actions/runs')) return jsonResponse({ workflow_runs: [] });
    if (url.pathname === '/repos/acme/app') {
      return jsonResponse({
        id: 1,
        full_name: 'acme/app',
        name: 'app',
        owner: { login: 'acme' },
        private: true,
        default_branch: 'main',
      });
    }
    return undefined;
  }

  it('shares same-second edited comment revision identities between webhook delivery and REST reconciliation', async () => {
    const createdAt = '2026-06-25T10:00:00Z';
    const editedAt = createdAt;
    const issueComment = {
      id: 101,
      body: 'Edited issue comment',
      html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: createdAt,
      updated_at: editedAt,
      user: { login: 'commenter' },
    };
    const reviewComment = {
      id: 103,
      body: 'Edited review comment',
      html_url: 'https://github.com/acme/app/pull/7#discussion-diff-103',
      pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
      path: 'src/conversation.ts',
      line: 42,
      created_at: createdAt,
      updated_at: editedAt,
      user: { login: 'reviewer' },
    };
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        return Promise.resolve(jsonResponse([issueComment]));
      }
      if (url.pathname === '/repos/acme/app/pulls/comments') {
        return Promise.resolve(jsonResponse([reviewComment]));
      }
      return Promise.resolve(
        emptyGithubFetch(input) ?? jsonResponse({ message: 'unexpected' }, 404),
      );
    });
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn().mockResolvedValue(undefined),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn().mockResolvedValue(undefined),
      },
    });

    const reconciledEvents = writeEvents.mock.calls.flatMap(([events]) => events);
    const webhook = githubProvider.handleWebhook?.bind(githubProvider);
    if (!webhook) throw new Error('no handleWebhook');
    const normalize = (
      result: Awaited<ReturnType<NonNullable<typeof githubProvider.handleWebhook>>>,
    ) => (Array.isArray(result) ? { events: result, syncTasks: [] } : result);
    const webhookIssueInput = {
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      // A delivery can have an ingress identity, but it must not affect a
      // raw-event revision key.
      externalDeliveryId: 'edited-issue-delivery',
      payload: {
        repository: { full_name: 'acme/app' },
        action: 'edited',
        issue: {
          id: 8,
          number: 8,
          title: 'Conversation issue',
          body: null,
          html_url: 'https://github.com/acme/app/issues/8',
          state: 'open',
          updated_at: editedAt,
          user: { login: 'author' },
        },
        comment: issueComment,
      },
    };
    const webhookIssue = normalize(await webhook(webhookIssueInput)).events.find(
      (event) => event.eventType === 'issue_comment.updated',
    );
    const webhookReviewInput = {
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      externalDeliveryId: 'edited-review-delivery',
      payload: {
        repository: { full_name: 'acme/app' },
        action: 'edited',
        pull_request: {
          id: 7,
          number: 7,
          title: 'Conversation PR',
          body: null,
          html_url: 'https://github.com/acme/app/pull/7',
          state: 'open',
          merged_at: null,
          updated_at: editedAt,
          user: { login: 'author' },
          base: { ref: 'main' },
          head: { ref: 'conversation-content' },
        },
        comment: reviewComment,
      },
    };
    const webhookReview = normalize(await webhook(webhookReviewInput)).events.find(
      (event) => event.eventType === 'pr.review_comment.updated',
    );

    expect(webhookIssue?.dedupKey).toBe(
      reconciledEvents.find((event) => event.eventType === 'issue_comment.updated')?.dedupKey,
    );
    expect(webhookReview?.dedupKey).toBe(
      reconciledEvents.find((event) => event.eventType === 'pr.review_comment.updated')?.dedupKey,
    );
  });

  it('replays a bounded comment overlap and captures late same-second comments', async () => {
    const highWater = '2026-06-10T12:00:00Z';
    const expectedSince = '2026-06-10T11:59:59Z';
    const issueReplay = {
      id: 101,
      body: 'Previously captured issue comment',
      html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: highWater,
      updated_at: highWater,
      user: { login: 'alice' },
    };
    const issueLate = {
      ...issueReplay,
      id: 102,
      body: 'Late issue comment from the same second',
      html_url: 'https://github.com/acme/app/issues/8#issuecomment-102',
    };
    const reviewReplay = {
      id: 201,
      body: 'Previously captured review comment',
      html_url: 'https://github.com/acme/app/pull/7#discussion-diff-201',
      pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
      created_at: highWater,
      updated_at: highWater,
      user: { login: 'bob' },
    };
    const reviewLate = {
      ...reviewReplay,
      id: 202,
      body: 'Late review comment from the same second',
      html_url: 'https://github.com/acme/app/pull/7#discussion-diff-202',
    };
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        expect(url.searchParams.get('since')).toBe(expectedSince);
        return Promise.resolve(jsonResponse([issueReplay, issueLate]));
      }
      if (url.pathname === '/repos/acme/app/pulls/comments') {
        expect(url.searchParams.get('since')).toBe(expectedSince);
        return Promise.resolve(jsonResponse([reviewReplay, reviewLate]));
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    const replayExternalObjectIds = new Set([
      `acme/app#issue:8:comment:${String(issueReplay.id)}`,
      `acme/app#7:review_comment:${String(reviewReplay.id)}`,
    ]);
    const persistedDedupKeys: string[] = [];
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockImplementation((events) => {
      for (const event of events) {
        if (replayExternalObjectIds.has(event.externalObjectId)) continue;
        persistedDedupKeys.push(event.dedupKey);
      }
      return Promise.resolve([]);
    });
    const saveCursor = vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn((resourceType: string) => {
          if (resourceType === 'github.repo:acme/app:issue_comments') {
            return Promise.resolve({ issue_comments_since: highWater });
          }
          if (resourceType === 'github.repo:acme/app:pr_review_comments') {
            return Promise.resolve({ pr_review_comments_since: highWater });
          }
          return Promise.resolve({});
        }),
        persistTokens: vi.fn(),
      },
    });

    const replayedBatches = writeEvents.mock.calls.flatMap(([events]) => events);
    expect(replayedBatches.map((event) => event.externalObjectId)).toEqual(
      expect.arrayContaining([...replayExternalObjectIds]),
    );
    expect(persistedDedupKeys).toEqual(
      expect.arrayContaining([
        expect.stringMatching(`^github:issue_comment:${String(issueLate.id)}:${highWater}:state:`),
        expect.stringMatching(
          `^github:review_comment:${String(reviewLate.id)}:${highWater}:state:`,
        ),
      ]),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: highWater,
    });
    expect(savedCursor(saveCursor, 'github.repo:acme/app:pr_review_comments')).toMatchObject({
      pr_review_comments_since: highWater,
    });
  });

  it('paginates dense high-water comment overlaps without reusing page-one validators', async () => {
    const highWater = '2026-06-10T12:00:00Z';
    const overlapSince = '2026-06-10T11:59:59Z';
    const issuePath = `/repos/acme/app/issues/comments?since=${encodeURIComponent(overlapSince)}&sort=updated&direction=asc&per_page=100&page=1`;
    const reviewPath = `/repos/acme/app/pulls/comments?since=${encodeURIComponent(overlapSince)}&sort=updated&direction=asc&per_page=100&page=1`;
    const issuePage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: `Replayed issue comment ${String(index + 1)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(index + 1)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: highWater,
      updated_at: highWater,
      user: { login: 'alice' },
    }));
    const reviewPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 201,
      body: `Replayed review comment ${String(index + 1)}`,
      html_url: `https://github.com/acme/app/pull/7#discussion-diff-${String(index + 201)}`,
      pull_request_url: 'https://api.github.com/repos/acme/app/pulls/7',
      created_at: highWater,
      updated_at: highWater,
      user: { login: 'bob' },
    }));
    const issueLate = {
      ...issuePage[0],
      id: 101,
      body: 'Late issue comment after the dense high-water page',
      html_url: 'https://github.com/acme/app/issues/8#issuecomment-101',
    };
    const reviewLate = {
      ...reviewPage[0],
      id: 301,
      body: 'Late review comment after the dense high-water page',
      html_url: 'https://github.com/acme/app/pull/7#discussion-diff-301',
    };
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      const headers = init?.headers as Record<string, string> | undefined;
      if (url.pathname === '/repos/acme/app/issues/comments') {
        expect(url.searchParams.get('since')).toBe(overlapSince);
        if (url.searchParams.get('page') === '1' && headers?.['if-none-match']) {
          return Promise.resolve(new Response(null, { status: 304 }));
        }
        return Promise.resolve(
          jsonResponse(url.searchParams.get('page') === '1' ? issuePage : [issueLate]),
        );
      }
      if (url.pathname === '/repos/acme/app/pulls/comments') {
        expect(url.searchParams.get('since')).toBe(overlapSince);
        if (url.searchParams.get('page') === '1' && headers?.['if-none-match']) {
          return Promise.resolve(new Response(null, { status: 304 }));
        }
        return Promise.resolve(
          jsonResponse(url.searchParams.get('page') === '1' ? reviewPage : [reviewLate]),
        );
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit,
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn((resourceType: string) => {
          if (resourceType === 'github.repo:acme/app:issue_comments') {
            return Promise.resolve({
              issue_comments_since: highWater,
              github_conditional: { [`issue_comments:${issuePath}`]: { etag: '"issue-etag"' } },
            });
          }
          if (resourceType === 'github.repo:acme/app:pr_review_comments') {
            return Promise.resolve({
              pr_review_comments_since: highWater,
              github_conditional: {
                [`pr_review_comments:${reviewPath}`]: { etag: '"review-etag"' },
              },
            });
          }
          return Promise.resolve({});
        }),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(
      events.some(({ dedupKey }) =>
        new RegExp(`^github:issue_comment:${String(issueLate.id)}:${highWater}:state:`).test(
          dedupKey,
        ),
      ),
    ).toBe(true);
    expect(
      events.some(({ dedupKey }) =>
        new RegExp(`^github:review_comment:${String(reviewLate.id)}:${highWater}:state:`).test(
          dedupKey,
        ),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        return (
          (url.pathname === '/repos/acme/app/issues/comments' ||
            url.pathname === '/repos/acme/app/pulls/comments') &&
          url.searchParams.get('page') === '2'
        );
      }),
    ).toHaveLength(2);
    expect(result).toEqual({
      continuations: [
        { resourceType: 'github.repo', externalId: 'acme/app', surface: 'issue_comments' },
        { resourceType: 'github.repo', externalId: 'acme/app', surface: 'pr_review_comments' },
      ],
    });
    expect(recordAudit).not.toHaveBeenCalledWith('github_incremental_partial', expect.anything());
  });

  it('replays a normal multi-page comment scan when the boundary mutates between pages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
    const committedHighWater = '2026-06-10T11:59:00Z';
    const observedHighWater = '2026-06-10T12:00:00Z';
    const overlapSince = '2026-06-10T11:58:59Z';
    const cursors = new Map<string, TestGithubCursor>();
    let pass: 'initial' | 'replay' = 'initial';
    const comment = (id: number) => ({
      id,
      body: `Comment ${String(id)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(id)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: observedHighWater,
      updated_at: observedHighWater,
      user: { login: 'alice' },
    });
    const initialPage = Array.from({ length: 100 }, (_, index) => comment(index + 1));
    const lateComment = comment(101);
    const mutation = comment(102);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        expect(url.searchParams.get('since')).toBe(overlapSince);
        const page = Number(url.searchParams.get('page'));
        if (pass === 'initial') {
          return Promise.resolve(
            jsonResponse(page === 1 ? initialPage : [initialPage[99], lateComment]),
          );
        }
        return Promise.resolve(
          jsonResponse(
            page === 1 ? [mutation, ...initialPage.slice(0, 99)] : [initialPage[99], lateComment],
          ),
        );
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });
    const sync = () =>
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

    cursors.set('github.repo:acme/app:issue_comments', {
      issue_comments_since: committedHighWater,
    });

    try {
      await expect(sync()).resolves.toMatchObject({
        continuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'issue_comments',
          },
        ],
      });
      expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
        issue_comments_since: committedHighWater,
        issue_comments_continuation: {
          since: overlapSince,
          page: 1,
          phase: 'replay',
          max_updated_at: observedHighWater,
        },
      });

      pass = 'replay';
      const replay = await sync();

      expect(replay?.continuations).toEqual([
        expect.objectContaining({
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
        }),
      ]);
      expect(replay?.continuations?.[0]?.retryAt).toBeInstanceOf(Date);
      expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
        issue_comments_since: committedHighWater,
        issue_comments_continuation: {
          since: overlapSince,
          page: 1,
          phase: 'replay',
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('replays a capped dense timestamp boundary before promoting it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
    const committedHighWater = '2026-06-10T11:59:00Z';
    const capHighWater = '2026-06-10T12:00:00Z';
    const capResumeSince = '2026-06-10T11:58:59Z';
    const cursors = new Map<string, TestGithubCursor>();
    const persistedDedupKeys = new Set<string>();
    let phase: 'dense-cap' | 'dense-resume' | 'dense-replay' | 'dense-confirm' = 'dense-cap';
    const comment = (id: number, updatedAt: string) => ({
      id,
      body: `Comment ${String(id)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(id)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: updatedAt,
      updated_at: updatedAt,
      user: { login: 'alice' },
    });
    const fullPage = (firstId: number, updatedAt: string) =>
      Array.from({ length: 100 }, (_, index) => comment(firstId + index, updatedAt));
    const replayBoundary = [
      comment(2002, capHighWater),
      ...Array.from({ length: 2001 }, (_, index) => comment(index + 1, capHighWater)),
    ];
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        const since = url.searchParams.get('since');
        const page = Number(url.searchParams.get('page'));
        expect(since).toBe(capResumeSince);
        if (phase === 'dense-cap') {
          return Promise.resolve(jsonResponse(fullPage((page - 1) * 100 + 1, capHighWater)));
        }
        if (phase === 'dense-resume') {
          expect(page).toBe(21);
          return Promise.resolve(jsonResponse([comment(2001, capHighWater)]));
        }
        return Promise.resolve(jsonResponse(replayBoundary.slice((page - 1) * 100, page * 100)));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockImplementation((events) => {
      for (const event of events) {
        if (persistedDedupKeys.has(event.dedupKey)) continue;
        persistedDedupKeys.add(event.dedupKey);
      }
      return Promise.resolve([]);
    });
    const sync = () =>
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents,
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

    cursors.set('github.repo:acme/app:issue_comments', {
      issue_comments_since: committedHighWater,
    });
    const capped = await sync();

    expect(capped?.continuations).toEqual([
      { resourceType: 'github.repo', externalId: 'acme/app', surface: 'issue_comments' },
    ]);
    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: committedHighWater,
      issue_comments_continuation: {
        since: capResumeSince,
        page: 21,
        phase: 'drain',
        max_updated_at: capHighWater,
      },
    });

    phase = 'dense-resume';
    const drained = await sync();

    expect(drained?.continuations).toEqual([
      { resourceType: 'github.repo', externalId: 'acme/app', surface: 'issue_comments' },
    ]);
    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: committedHighWater,
      issue_comments_continuation: {
        since: capResumeSince,
        page: 1,
        phase: 'replay',
        max_updated_at: capHighWater,
      },
    });

    phase = 'dense-replay';
    const replayCapped = await sync();

    expect(replayCapped?.continuations).toEqual([
      { resourceType: 'github.repo', externalId: 'acme/app', surface: 'issue_comments' },
    ]);
    const replayCursor = cursors.get('github.repo:acme/app:issue_comments');
    const replayContinuation = replayCursor?.issue_comments_continuation;
    expect(replayCursor).toMatchObject({
      issue_comments_since: committedHighWater,
      issue_comments_continuation: {
        since: capResumeSince,
        page: 21,
        phase: 'replay',
        max_updated_at: capHighWater,
      },
    });
    expect(replayContinuation?.expected_fingerprint).toBeTypeOf('string');
    expect(replayContinuation?.scan_fingerprint).toBeTypeOf('string');

    const changedReplay = await sync();

    expect(changedReplay?.continuations).toEqual([
      expect.objectContaining({
        resourceType: 'github.repo',
        externalId: 'acme/app',
      }),
    ]);
    expect(changedReplay?.continuations?.[0]?.retryAt).toBeInstanceOf(Date);
    const changedReplayCursor = cursors.get('github.repo:acme/app:issue_comments');
    const changedReplayContinuation = changedReplayCursor?.issue_comments_continuation;
    expect(changedReplayCursor).toMatchObject({
      issue_comments_since: committedHighWater,
      issue_comments_continuation: {
        since: capResumeSince,
        page: 1,
        phase: 'replay',
        max_updated_at: capHighWater,
      },
    });
    expect(changedReplayContinuation?.expected_fingerprint).toBeTypeOf('string');

    phase = 'dense-confirm';
    vi.advanceTimersByTime(5_000);
    await sync();
    const replayed = await sync();

    expect(replayed).toBeUndefined();
    expect([...persistedDedupKeys]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(`^github:issue_comment:2002:${capHighWater}:state:`),
      ]),
    );
    expect(cursors.get('github.repo:acme/app:issue_comments')).not.toHaveProperty(
      'issue_comments_continuation',
    );
    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: capHighWater,
    });
    vi.useRealTimers();
  });

  it('promotes a stable capped dense comment boundary after one matching replay', async () => {
    const committedHighWater = '2026-06-10T11:59:00Z';
    const capHighWater = '2026-06-10T12:00:00Z';
    const capResumeSince = '2026-06-10T11:58:59Z';
    const cursors = new Map<string, TestGithubCursor>();
    const comment = (id: number) => ({
      id,
      body: `Comment ${String(id)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(id)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: capHighWater,
      updated_at: capHighWater,
      user: { login: 'alice' },
    });
    const fullPage = (page: number) =>
      Array.from({ length: 100 }, (_, index) => comment((page - 1) * 100 + index + 1));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        expect(url.searchParams.get('since')).toBe(capResumeSince);
        const page = Number(url.searchParams.get('page'));
        return Promise.resolve(jsonResponse(page <= 20 ? fullPage(page) : [comment(2001)]));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });
    const sync = () =>
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

    cursors.set('github.repo:acme/app:issue_comments', {
      issue_comments_since: committedHighWater,
    });

    await expect(sync()).resolves.toMatchObject({
      continuations: [{ resourceType: 'github.repo', externalId: 'acme/app' }],
    });
    await expect(sync()).resolves.toMatchObject({
      continuations: [{ resourceType: 'github.repo', externalId: 'acme/app' }],
    });
    await expect(sync()).resolves.toMatchObject({
      continuations: [{ resourceType: 'github.repo', externalId: 'acme/app' }],
    });
    await expect(sync()).resolves.toBeUndefined();

    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: capHighWater,
    });
    expect(cursors.get('github.repo:acme/app:issue_comments')).not.toHaveProperty(
      'issue_comments_continuation',
    );
  });

  it('bounds replay retries for a boundary that keeps changing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
    const highWater = '2026-06-10T12:00:00Z';
    const cursors = new Map<string, TestGithubCursor>();
    let id = 1;
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        const comment = {
          id: id++,
          body: 'A boundary that keeps changing',
          html_url: 'https://github.com/acme/app/issues/8#issuecomment-changing',
          issue_url: 'https://api.github.com/repos/acme/app/issues/8',
          created_at: highWater,
          updated_at: highWater,
          user: { login: 'alice' },
        };
        return Promise.resolve(jsonResponse([comment]));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });
    const sync = () =>
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

    cursors.set('github.repo:acme/app:issue_comments', {
      issue_comments_since: highWater,
      issue_comments_continuation: {
        since: '2026-06-10T11:59:59Z',
        page: 1,
        phase: 'replay',
        expected_fingerprint: 'an-earlier-boundary',
      },
    });

    const firstReplay = await sync();
    expect(firstReplay).toMatchObject({
      continuations: [
        expect.objectContaining({
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
        }),
      ],
    });
    expect(firstReplay?.continuations?.[0]?.retryAt).toBeInstanceOf(Date);
    vi.advanceTimersByTime(5_000);
    const retryingReplay = await sync();
    expect(retryingReplay?.continuations).toBeInstanceOf(Array);
    vi.advanceTimersByTime(10_000);
    await expect(sync()).resolves.toBeUndefined();

    const retryCursor = cursors.get('github.repo:acme/app:issue_comments');
    const retryContinuation = retryCursor?.issue_comments_continuation;
    expect(retryCursor).toMatchObject({
      issue_comments_since: highWater,
      issue_comments_continuation: {
        phase: 'replay',
        page: 1,
        replay_attempts: 3,
      },
    });
    expect(retryContinuation?.replay_retry_at).toBeTypeOf('string');

    id = 3;
    vi.advanceTimersByTime(20_000);
    await expect(sync()).resolves.toBeUndefined();
    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_since: highWater,
    });
    expect(cursors.get('github.repo:acme/app:issue_comments')).not.toHaveProperty(
      'issue_comments_continuation',
    );
    vi.useRealTimers();
  });

  it('returns a safe continuation when a comment checkpoint hits a transient error', async () => {
    const cursors = new Map<string, TestGithubCursor>();
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        return Promise.reject(new Error('GitHub temporarily overloaded'));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn().mockResolvedValue(undefined),
        saveCursor,
        loadCursor: vi.fn((resourceType: string) =>
          Promise.resolve(cursors.get(resourceType) ?? {}),
        ),
        persistTokens: vi.fn(),
      },
    });

    expect(result).toMatchObject({
      partialFailures: [expect.objectContaining({ surface: 'issue_comments' })],
      continuations: [
        expect.objectContaining({
          resourceType: 'github.repo',
          externalId: 'acme/app',
        }),
      ],
    });
    expect(result?.continuations?.[0]?.retryAt).toBeInstanceOf(Date);
    const recoveryCursor = cursors.get('github.repo:acme/app:issue_comments');
    const recoveryContinuation = recoveryCursor?.issue_comments_continuation;
    expect(recoveryCursor).toMatchObject({
      issue_comments_continuation: {
        page: 1,
        phase: 'drain',
        recovery_attempts: 1,
      },
    });
    expect(recoveryContinuation?.recovery_retry_at).toBeTypeOf('string');
  });

  it('keeps each persisted conversation recovery deadline isolated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00.000Z'));
    const issueRetryAt = new Date('2026-06-12T12:01:00.000Z');
    const reviewRetryAt = new Date('2026-06-12T12:02:00.000Z');
    const cursors = new Map<string, TestGithubCursor>([
      [
        'github.repo:acme/app:issue_comments',
        {
          issue_comments_continuation: {
            since: '2026-06-12T11:59:59Z',
            page: 3,
            phase: 'drain',
            recovery_attempts: 2,
            recovery_retry_at: issueRetryAt.toISOString(),
          },
        },
      ],
      [
        'github.repo:acme/app:pr_review_comments',
        {
          pr_review_comments_continuation: {
            since: '2026-06-12T11:59:59Z',
            page: 4,
            phase: 'drain',
            recovery_attempts: 1,
            recovery_retry_at: reviewRetryAt.toISOString(),
          },
        },
      ],
    ]);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (
        url.pathname === '/repos/acme/app/issues/comments' ||
        url.pathname === '/repos/acme/app/pulls/comments'
      ) {
        return Promise.reject(new Error('conversation retry deadline was ignored'));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined);

    try {
      const result = await githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

      expect(result).toEqual({
        continuations: [
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'issue_comments',
            retryAt: issueRetryAt,
          },
          {
            resourceType: 'github.repo',
            externalId: 'acme/app',
            surface: 'pr_review_comments',
            retryAt: reviewRetryAt,
          },
        ],
      });
      expect(
        fetchMock.mock.calls.filter(([input]) => {
          const requestUrl =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          return /\/(issues|pulls)\/comments$/u.test(new URL(requestUrl).pathname);
        }),
      ).toHaveLength(0);
      const savedResourceTypes = saveCursor.mock.calls.map(([resourceType]) => resourceType);
      expect(savedResourceTypes).not.toContain('github.repo:acme/app:issue_comments');
      expect(savedResourceTypes).not.toContain('github.repo:acme/app:pr_review_comments');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a targeted conversation continuation only for its requested surface', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        return Promise.reject(new Error('targeted review sync scanned issue comments'));
      }
      if (url.pathname === '/repos/acme/app/pulls/comments') {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        target: {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'pr_review_comments',
          reason: 'provider_pagination_continuation',
        },
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor: vi.fn().mockResolvedValue(undefined),
          loadCursor: vi.fn().mockResolvedValue({}),
          persistTokens: vi.fn(),
        },
      }),
    ).resolves.toBeUndefined();

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname === '/repos/acme/app/issues/comments';
      }),
    ).toBe(false);
  });

  it('carries comment continuations collected before a later surface rate limit', async () => {
    const highWater = '2026-06-10T12:00:00Z';
    const comment = (id: number) => ({
      id,
      body: `Comment ${String(id)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(id)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: highWater,
      updated_at: highWater,
      user: { login: 'alice' },
    });
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        const page = Number(url.searchParams.get('page'));
        return Promise.resolve(
          jsonResponse(
            Array.from({ length: 100 }, (_, index) => comment((page - 1) * 100 + index + 1)),
          ),
        );
      }
      if (url.pathname === '/repos/acme/app/pulls/comments') {
        return Promise.resolve(
          jsonResponse({ message: 'secondary rate limit' }, 403, { 'retry-after': '60' }),
        );
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor: vi.fn().mockResolvedValue(undefined),
          loadCursor: vi.fn().mockResolvedValue({}),
          persistTokens: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      code: 'github_rate_limited',
      syncContinuations: [
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'issue_comments',
        },
        {
          resourceType: 'github.repo',
          externalId: 'acme/app',
          surface: 'pr_review_comments',
        },
      ],
    });
  });

  it('checkpoints a later-page comment rate limit before retrying from a safe overlap', async () => {
    const initialSince = '1970-01-01T00:00:00.000Z';
    const firstSecond = '2026-06-10T12:00:00Z';
    const secondSecond = '2026-06-10T12:00:01Z';
    const cursors = new Map<string, TestGithubCursor>();
    const persistedDedupKeys = new Set<string>();
    let rateLimited = true;
    const comment = (id: number, updatedAt: string) => ({
      id,
      body: `Comment ${String(id)}`,
      html_url: `https://github.com/acme/app/issues/8#issuecomment-${String(id)}`,
      issue_url: 'https://api.github.com/repos/acme/app/issues/8',
      created_at: updatedAt,
      updated_at: updatedAt,
      user: { login: 'alice' },
    });
    const fullPage = (firstId: number, updatedAt: string) =>
      Array.from({ length: 100 }, (_, index) => comment(firstId + index, updatedAt));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/repos/acme/app/issues/comments') {
        const since = url.searchParams.get('since');
        const page = Number(url.searchParams.get('page'));
        if (rateLimited) {
          expect(since).toBe(initialSince);
          if (page === 1) return Promise.resolve(jsonResponse(fullPage(1, firstSecond)));
          if (page === 2) return Promise.resolve(jsonResponse(fullPage(101, secondSecond)));
          return Promise.resolve(
            new Response(JSON.stringify({ message: 'secondary rate limit' }), {
              status: 403,
              headers: { 'content-type': 'application/json', 'retry-after': '60' },
            }),
          );
        }
        expect(since).toBe(initialSince);
        expect(page).toBe(3);
        return Promise.resolve(jsonResponse([comment(201, secondSecond)]));
      }
      if (url.pathname === '/repos/acme/app/commits') return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi
      .fn<SyncContext['saveCursor']>()
      .mockImplementation((resourceType, cursor) => {
        cursors.set(resourceType, cursor as TestGithubCursor);
        return Promise.resolve(undefined);
      });
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockImplementation((events) => {
      for (const event of events) {
        if (persistedDedupKeys.has(event.dedupKey)) continue;
        persistedDedupKeys.add(event.dedupKey);
      }
      return Promise.resolve([]);
    });
    const sync = () =>
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents,
          recordAudit: vi.fn().mockResolvedValue(undefined),
          saveCursor,
          loadCursor: vi.fn((resourceType: string) =>
            Promise.resolve(cursors.get(resourceType) ?? {}),
          ),
          persistTokens: vi.fn(),
        },
      });

    await expect(sync()).rejects.toMatchObject({
      code: 'github_rate_limited',
      syncContinuation: {
        resourceType: 'github.repo',
        externalId: 'acme/app',
        surface: 'issue_comments',
      },
    });

    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_continuation: {
        since: initialSince,
        page: 3,
        phase: 'drain',
        max_updated_at: secondSecond,
      },
    });

    rateLimited = false;
    const resumed = await sync();

    expect(resumed?.continuations).toEqual([
      { resourceType: 'github.repo', externalId: 'acme/app', surface: 'issue_comments' },
    ]);
    expect([...persistedDedupKeys]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(`^github:issue_comment:201:${secondSecond}:state:`),
      ]),
    );
    expect(cursors.get('github.repo:acme/app:issue_comments')).toMatchObject({
      issue_comments_continuation: {
        since: initialSince,
        page: 1,
        phase: 'replay',
        max_updated_at: secondSecond,
      },
    });
  });

  it('uses GitHub App installation tokens for repository syncs without persisting the transient bearer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:00:00.000Z'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GITHUB_APP_ID = '999';
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey
      .export({ format: 'pem', type: 'pkcs1' })
      .replaceAll('\n', '\\n');
    resetEnvForTests();
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/app/installations/123/access_tokens') {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(init?.method).toBe('POST');
        expect(headers?.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/u);
        return Promise.resolve(
          jsonResponse({
            token: 'ghs_installation',
            expires_at: '2026-06-25T03:00:00.000Z',
          }),
        );
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const persistTokens = vi.fn<SyncContext['persistTokens']>().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: {
        access_token: 'ghu_user',
        github_app_installations: [{ id: '123', account_login: 'acme' }],
      },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens,
      },
    });

    const repoCalls = fetchMock.mock.calls.filter(([input]) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      return new URL(requestUrl).pathname.startsWith('/repos/acme/app');
    });
    expect(repoCalls.length).toBeGreaterThan(0);
    expect(
      repoCalls.every(([, init]) => {
        const headers = init?.headers as Record<string, string> | undefined;
        return headers?.authorization === 'Bearer ghs_installation';
      }),
    ).toBe(true);
    expect(persistTokens).toHaveBeenCalledWith({
      access_token: 'ghu_user',
      github_app_installations: [{ id: '123', account_login: 'acme' }],
      github_app_installation_tokens: {
        '123': { token: 'ghs_installation', expires_at: Date.parse('2026-06-25T03:00:00.000Z') },
      },
    });
    expect(persistTokens.mock.calls[0]?.[0]).not.toHaveProperty('github_installation_access_token');
  });

  it('paginates commit bursts so polling does not drop events beyond the first page', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      const base = emptyGithubFetch(input);
      if (base) return Promise.resolve(base);
      if (url.pathname.endsWith('/commits')) {
        const page = url.searchParams.get('page');
        return Promise.resolve(
          jsonResponse(
            page === '1'
              ? Array.from({ length: 100 }, (_, index) => commit(index + 1))
              : [commit(101), commit(102)],
          ),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).toHaveLength(102);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/commits?sha=main&per_page=100&page=2'),
      expect.any(Object),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toMatchObject({
      last_sha: 'sha-001',
    });
  });

  it('uses commit ETags to skip unchanged commit reconciliation', async () => {
    const commitPath = '/repos/acme/app/commits?sha=main&per_page=100&page=1';
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"commit-etag"');
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: '"commit-etag-next"' },
          }),
        );
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:commits'
          ? {
              last_sha: 'sha-001',
              github_conditional: {
                [`commits:${commitPath}`]: { etag: '"commit-etag"' },
              },
            }
          : resourceType === 'github.repo:acme/app:releases' ||
              resourceType === 'github.repo:acme/app:workflow_runs'
            ? { last_polled_at: new Date().toISOString() }
            : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit,
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'commit' })]),
    );
    expect(recordAudit).not.toHaveBeenCalledWith(
      'github_commit_cursor_target_missing',
      expect.anything(),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toMatchObject({
      last_sha: 'sha-001',
      github_conditional: {
        [`commits:${commitPath}`]: { etag: '"commit-etag-next"' },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname.endsWith('/commits');
      }),
    ).toHaveLength(1);
  });

  it('treats an empty Git repository as a successful commit sync', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) {
        return Promise.resolve(jsonResponse({ message: 'Git Repository is empty.' }, 409));
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn<SyncContext['saveCursor']>().mockResolvedValue(undefined);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(result).toBeUndefined();
    expect(writeEvents).not.toHaveBeenCalled();
    expect(savedStatus(saveCursor, 'github.repo:acme/app:commits')).not.toMatchObject({
      lastStatus: 'error',
    });
    expect(recordAudit).not.toHaveBeenCalledWith('github_incremental_partial', expect.anything());
  });

  it('expands org selections at sync time and de-dupes explicit repo selections', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/orgs/acme/repos') {
        return Promise.resolve(
          jsonResponse(
            url.searchParams.get('page') === '1'
              ? [
                  {
                    id: 1,
                    full_name: 'acme/app',
                    name: 'app',
                    owner: { login: 'acme' },
                    private: true,
                    default_branch: 'main',
                  },
                  {
                    id: 2,
                    full_name: 'acme/api',
                    name: 'api',
                    owner: { login: 'acme' },
                    private: true,
                    default_branch: 'main',
                  },
                ]
              : [],
          ),
        );
      }
      if (url.pathname === '/repos/acme/api') {
        return Promise.resolve(
          jsonResponse({
            id: 2,
            full_name: 'acme/api',
            name: 'api',
            owner: { login: 'acme' },
            private: true,
            default_branch: 'main',
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [
        { kind: 'github.repo', externalId: 'acme/app' },
        { kind: 'github.org', externalId: 'acme' },
      ],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(new Set(saveCursor.mock.calls.map(([resourceType]) => String(resourceType)))).toEqual(
      new Set([
        'github.org:acme:repos',
        'github.repo:acme/api:prs',
        'github.repo:acme/api:issues',
        'github.repo:acme/api:issue_comments',
        'github.repo:acme/api:pr_review_comments',
        'github.repo:acme/api:releases',
        'github.repo:acme/api:commits',
        'github.repo:acme/api:workflow_runs',
        'github.repo:acme/app:prs',
        'github.repo:acme/app:issues',
        'github.repo:acme/app:issue_comments',
        'github.repo:acme/app:pr_review_comments',
        'github.repo:acme/app:releases',
        'github.repo:acme/app:commits',
        'github.repo:acme/app:workflow_runs',
      ]),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname === '/repos/acme/app';
      }),
    ).toHaveLength(1);
  });

  it('uses the cached org repo expansion during steady-state syncs', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === '/orgs/acme/repos') {
        return Promise.resolve(jsonResponse({ message: 'should use cache' }, 500));
      }
      if (url.pathname === '/repos/acme/app') {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            full_name: 'acme/app',
            name: 'app',
            owner: { login: 'acme' },
            private: true,
            default_branch: 'main',
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.org:acme:repos'
          ? { repos: ['acme/app'], fetched_at: new Date().toISOString() }
          : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.org', externalId: 'acme' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname === '/orgs/acme/repos';
      }),
    ).toBe(false);
    expect(saveCursor).not.toHaveBeenCalledWith('github.org:acme:repos', expect.anything());
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toBeDefined();
  });

  it('voluntarily pauses before draining the GitHub primary quota to zero', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('state') === 'open') {
        return Promise.resolve(
          jsonResponse([], 200, {
            'x-ratelimit-remaining': '250',
            'x-ratelimit-reset': String(Date.parse('2026-06-25T11:00:00.000Z') / 1000),
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'should pause before next call' }, 500));
    });
    globalThis.fetch = fetchMock;

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn(),
          saveCursor: vi.fn().mockResolvedValue(undefined),
          loadCursor: vi.fn().mockResolvedValue({}),
          persistTokens: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      code: 'github_rate_limited',
      retryAt: new Date('2026-06-25T11:00:00.000Z'),
      rateLimitKind: 'primary',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('paginates PR reviews so polling replaces the removed webhook surface', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls')) {
        return Promise.resolve(
          jsonResponse(url.searchParams.get('state') === 'open' ? [pullRequest()] : []),
        );
      }
      if (url.pathname.endsWith('/pulls/7/reviews')) {
        const page = url.searchParams.get('page');
        return Promise.resolve(
          jsonResponse(
            page === '1'
              ? Array.from({ length: 100 }, (_, index) => review(index + 1))
              : [review(101)],
          ),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor: vi.fn(),
        loadCursor: vi.fn().mockResolvedValue({ since: '2026-06-10T10:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(events.filter((event) => event.eventType === 'pr.review.approved')).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/pulls/7/reviews?per_page=100&page=2'),
      expect.any(Object),
    );
  });

  it('uses PR ETags to skip unchanged PR reconciliation by state query', async () => {
    const openPullsPath =
      '/repos/acme/app/pulls?state=open&sort=updated&direction=desc&per_page=100&page=1';
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('state') === 'open') {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"open-pr-etag"');
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: '"open-pr-etag-next"' },
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:prs'
          ? {
              prs_since: '2026-06-10T10:00:00Z',
              github_conditional: {
                [`prs:${openPullsPath}`]: { etag: '"open-pr-etag"' },
              },
            }
          : resourceType === 'github.repo:acme/app:releases' ||
              resourceType === 'github.repo:acme/app:workflow_runs'
            ? { last_polled_at: new Date().toISOString() }
            : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'pr.opened' })]),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:prs')).toMatchObject({
      prs_since: '2026-06-10T10:00:00Z',
      github_conditional: {
        [`prs:${openPullsPath}`]: { etag: '"open-pr-etag-next"' },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(requestUrl);
        return url.pathname.endsWith('/pulls') && url.searchParams.get('state') === 'open';
      }),
    ).toHaveLength(1);
  });

  it('maps GitHub PRs and issues to task display titles without numbers', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls')) {
        return Promise.resolve(
          jsonResponse(url.searchParams.get('state') === 'open' ? [pullRequest()] : []),
        );
      }
      if (url.pathname.endsWith('/pulls/7/reviews')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/issues')) return Promise.resolve(jsonResponse([issueRow(42)]));
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor: vi.fn(),
        loadCursor: vi.fn().mockResolvedValue({ since: '2026-06-10T10:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    const mappedObjects = events.flatMap((event) => (event.objectMap ? [event.objectMap] : []));
    const prMap = mappedObjects.find((map) => map.canonicalName === 'acme/app#7: Add polling');
    const issueMap = mappedObjects.find((map) => map.canonicalName === 'acme/app#42: Issue row');
    expect(prMap?.displayTitle).toBe('app: Add polling');
    expect(issueMap?.displayTitle).toBe('app: Issue row');
  });

  it('treats PR review fetch failures as partial sync failures', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls')) {
        return Promise.resolve(
          jsonResponse(url.searchParams.get('state') === 'open' ? [pullRequest()] : []),
        );
      }
      if (url.pathname.endsWith('/pulls/7/reviews')) {
        return Promise.resolve(jsonResponse({ message: 'reviews unavailable' }, 500));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ since: '2026-06-10T10:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    expect(savedCursor(saveCursor, 'github.repo:acme/app:prs')).toMatchObject({
      prs_since: '2026-06-10T10:00:00Z',
    });
    const prsStatus = savedStatus(saveCursor, 'github.repo:acme/app:prs');
    expect(prsStatus).toMatchObject({
      lastStatus: 'error',
    });
    expect(prsStatus?.lastError).toContain('reviews:7');
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toBeDefined();
    const auditPayload = recordAudit.mock.calls.find(
      ([kind]) => kind === 'github_incremental_partial',
    )?.[1];
    expect(auditPayload).toMatchObject({ failure_count: 1 });
    expect(typeof auditPayload?.summary === 'string' ? auditPayload.summary : undefined).toContain(
      'acme/app:prs:reviews:7',
    );
  });

  it('aborts the sync immediately when GitHub returns a secondary rate limit', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/issues')) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'secondary rate limit' }), {
            status: 403,
            headers: { 'content-type': 'application/json', 'retry-after': '90' },
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn(),
          saveCursor: vi.fn(),
          loadCursor: vi.fn().mockResolvedValue({}),
          recordAudit: vi.fn(),
          persistTokens: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      code: 'github_rate_limited',
      rateLimitKind: 'secondary',
      retryAfterSeconds: 90,
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/releases'),
      expect.any(Object),
    );
  });

  it('surfaces the missing GitHub App pull request permission clearly', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls') && url.searchParams.get('state') === 'open') {
        return Promise.resolve(jsonResponse({ message: 'Bad credentials' }, 401));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    const prsStatus = savedStatus(saveCursor, 'github.repo:acme/app:prs');
    expect(prsStatus).toMatchObject({
      lastStatus: 'error',
    });
    expect(prsStatus?.lastError).toContain('Pull requests read permission required');
    expect(result?.partialFailures).toEqual([
      {
        resource: 'acme/app',
        surface: 'prs',
        area: 'prs:open',
        error:
          'Pull requests read permission required; update GitHub App repository permissions and reconnect',
      },
    ]);
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toBeDefined();
    const auditPayload = recordAudit.mock.calls.find(
      ([kind]) => kind === 'github_incremental_partial',
    )?.[1];
    expect(typeof auditPayload?.summary === 'string' ? auditPayload.summary : undefined).toContain(
      'Pull requests read permission required',
    );
  });

  it('captures release publish transitions even when the release id was already seen', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        return Promise.resolve(jsonResponse([release(1, '2026-06-10T12:00:00Z')]));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({
          last_release_id: 1,
          releases_since: '2026-06-09T00:00:00Z',
        }),
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).toEqual([
      expect.objectContaining({ eventType: 'release.published' }),
    ]);
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      releases_since: '2026-06-10T12:00:00Z',
    });
  });

  it('captures a published release during legacy id cursor migration', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        return Promise.resolve(jsonResponse([release(1, '2026-06-10T12:00:00Z')]));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ last_release_id: 1 }),
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).toEqual([
      expect.objectContaining({ eventType: 'release.published' }),
    ]);
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      last_release_id: 1,
      releases_since: '2026-06-10T12:00:00Z',
    });
  });

  it('uses release ETags to skip unchanged release reconciliation', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"release-etag"');
        expect(headers?.['if-modified-since']).toBe('Wed, 25 Jun 2026 10:00:00 GMT');
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: {
              etag: '"release-etag-next"',
              'last-modified': 'Wed, 25 Jun 2026 11:00:00 GMT',
            },
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:releases'
          ? {
              releases_since: '2026-06-10T00:00:00Z',
              github_conditional: {
                'releases:first': {
                  etag: '"release-etag"',
                  lastModified: 'Wed, 25 Jun 2026 10:00:00 GMT',
                },
              },
            }
          : resourceType === 'github.repo:acme/app:workflow_runs'
            ? { last_polled_at: new Date().toISOString() }
            : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'release.published' })]),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      releases_since: '2026-06-10T00:00:00Z',
      github_conditional: {
        'releases:first': {
          etag: '"release-etag-next"',
          lastModified: 'Wed, 25 Jun 2026 11:00:00 GMT',
        },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname.endsWith('/releases');
      }),
    ).toHaveLength(1);
  });

  it('continues release pagination when a full page mixes old and new releases', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        const page = url.searchParams.get('page');
        return Promise.resolve(
          jsonResponse(
            page === '1'
              ? [
                  release(200, '2026-06-10T12:00:00Z'),
                  ...Array.from({ length: 99 }, (_, index) =>
                    release(199 - index, '2026-06-09T12:00:00Z'),
                  ),
                ]
              : [release(50, '2026-06-10T13:00:00Z')],
          ),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ releases_since: '2026-06-10T00:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(events.filter((event) => event.eventType === 'release.published')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/releases?per_page=100&page=2'),
      expect.any(Object),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      releases_since: '2026-06-10T13:00:00Z',
    });
  });

  it('stops release pagination on a full stale page without a page-cap failure', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        return Promise.resolve(
          jsonResponse(
            Array.from({ length: 100 }, (_, index) => release(200 - index, '2026-06-09T12:00:00Z')),
          ),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn().mockResolvedValue({ releases_since: '2026-06-10T00:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/releases?per_page=100&page=2'),
      expect.any(Object),
    );
  });

  it('continues workflow run pagination even when an early full page contains old runs', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/actions/runs')) {
        const page = url.searchParams.get('page');
        return Promise.resolve(
          jsonResponse({
            workflow_runs:
              page === '1'
                ? [
                    workflowRun(1, '2026-06-10T09:00:00Z'),
                    ...Array.from({ length: 99 }, (_, index) =>
                      workflowRun(index + 2, '2026-06-10T11:00:00Z'),
                    ),
                  ]
                : [workflowRun(101, '2026-06-10T12:00:00Z')],
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({
          workflow_runs_since: '2026-06-10T10:00:00Z',
        }),
        persistTokens: vi.fn(),
      },
    });

    const events = writeEvents.mock.calls.flatMap(([batch]) => batch);
    expect(events.filter((event) => event.eventType === 'workflow_run.success')).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/actions/runs?per_page=100&page=2'),
      expect.any(Object),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:workflow_runs')).toMatchObject({
      workflow_runs_since: '2026-06-10T12:00:00Z',
    });
  });

  it('uses workflow ETags to skip unchanged workflow run reconciliation', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/actions/runs')) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"workflow-etag"');
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: '"workflow-etag-next"' },
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:releases'
          ? { last_polled_at: new Date().toISOString() }
          : resourceType === 'github.repo:acme/app:workflow_runs'
            ? {
                workflow_runs_since: '2026-06-10T10:00:00Z',
                github_conditional: {
                  'workflow_runs:first': { etag: '"workflow-etag"' },
                },
              }
            : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'workflow_run.success' })]),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:workflow_runs')).toMatchObject({
      workflow_runs_since: '2026-06-10T10:00:00Z',
      github_conditional: {
        'workflow_runs:first': { etag: '"workflow-etag-next"' },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname.endsWith('/actions/runs');
      }),
    ).toHaveLength(1);
  });

  it('stops workflow run pagination on a full stale page without a page-cap failure', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/actions/runs')) {
        return Promise.resolve(
          jsonResponse({
            workflow_runs: Array.from({ length: 100 }, (_, index) =>
              workflowRun(index + 1, '2026-06-10T09:00:00Z'),
            ),
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn().mockResolvedValue({
          workflow_runs_since: '2026-06-10T10:00:00Z',
        }),
        persistTokens: vi.fn(),
      },
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/actions/runs?per_page=100&page=2'),
      expect.any(Object),
    );
  });

  it('skips low-value repo surfaces when their surface cursors were polled recently', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:releases' ||
          resourceType === 'github.repo:acme/app:workflow_runs'
          ? { last_polled_at: '2026-06-25T11:30:00.000Z' }
          : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/releases'),
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/actions/runs'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/commits'),
      expect.any(Object),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toBeUndefined();
    expect(savedCursor(saveCursor, 'github.repo:acme/app:workflow_runs')).toBeUndefined();
    vi.useRealTimers();
  });

  it('clears the poll marker when a low-cadence surface fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T12:00:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        return Promise.resolve(jsonResponse({ message: 'release API unavailable' }, 500));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:releases'
          ? {
              last_polled_at: '2026-06-24T09:30:00.000Z',
              releases_since: '2026-06-10T00:00:00Z',
            }
          : {},
      ),
    );

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/acme/app/releases'),
      expect.any(Object),
    );
    expect(result?.partialFailures?.[0]).toMatchObject({
      resource: 'acme/app',
      surface: 'releases',
      area: 'releases',
    });
    expect(result?.partialFailures?.[0]?.error).toContain(
      'GitHub GET /repos/acme/app/releases 500:',
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      releases_since: '2026-06-10T00:00:00Z',
    });
    expect(
      savedCursor(saveCursor, 'github.repo:acme/app:releases')?.last_polled_at,
    ).toBeUndefined();
    expect(savedStatus(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      lastStatus: 'error',
    });
    vi.useRealTimers();
  });

  it('keeps GitHub HTTP status visible when summarizing long commit URLs', async () => {
    const repo = 'acme/super-long-repository-name-for-status-retention-tests';
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname === `/repos/${repo}`) {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            full_name: repo,
            name: 'super-long-repository-name-for-status-retention-tests',
            owner: { login: 'acme' },
            private: true,
            default_branch: 'main',
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) {
        return Promise.resolve(jsonResponse({ message: 'Not Found' }, 404));
      }
      if (url.pathname.endsWith('/pulls')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/issues')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/issues/comments')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/pulls/comments')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/releases')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/actions/runs')) {
        return Promise.resolve(jsonResponse({ workflow_runs: [] }));
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;

    const result = await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: repo }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(result?.partialFailures).toEqual([
      {
        resource: repo,
        surface: 'commits',
        area: 'commits',
        error:
          'GitHub GET /repos/acme/super-long-repository-name-for-status-retention-tests/commits 404: {"message":"Not Found"}',
      },
    ]);
  });

  it('advances the issue cursor when fetched rows are PRs filtered out of issue events', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/issues')) {
        return Promise.resolve(jsonResponse([issueRow(8, true)]));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ issues_since: '2026-06-10T12:00:00Z' }),
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).toEqual([]);
    expect(savedCursor(saveCursor, 'github.repo:acme/app:issues')).toMatchObject({
      issues_since: '2026-06-10T13:08:00Z',
    });
  });

  it('mints a polling reopen dedup key when issue lifecycle history shows closed→open', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/issues')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 8,
              number: 8,
              title: 'Bug report',
              body: null,
              html_url: 'https://github.com/acme/app/issues/8',
              state: 'open',
              updated_at: '2026-06-25T13:00:00Z',
              user: { login: 'bob' },
            },
          ]),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn((resourceType: string) =>
          Promise.resolve(
            resourceType === 'github.repo:acme/app:issues'
              ? {
                  issues_since: '2026-06-25T12:00:00Z',
                  issue_lifecycles: { '8': 'closed' },
                }
              : resourceType === 'github.repo:acme/app:releases' ||
                  resourceType === 'github.repo:acme/app:workflow_runs'
                ? { last_polled_at: new Date().toISOString() }
                : {},
          ),
        ),
        persistTokens: vi.fn(),
      },
    });

    const issueEvents = writeEvents.mock.calls
      .flatMap(([events]) => events)
      .filter((event) => event.dedupKey.startsWith('github:issue:8:'));
    expect(issueEvents[0]?.dedupKey).toBe('github:issue:8:open:2026-06-25T13:00:00Z');
    expect(issueEvents[0]?.eventType).toBe('issue.reopened');
    expect(savedCursor(saveCursor, 'github.repo:acme/app:issues')).toMatchObject({
      issue_lifecycles: { '8': 'open' },
    });
  });

  it('uses issue ETags to skip unchanged issue reconciliation by since query', async () => {
    const issuesPath =
      '/repos/acme/app/issues?state=all&since=2026-06-10T12%3A00%3A00Z&sort=updated&direction=desc&per_page=100&page=1';
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/issues')) {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.['if-none-match']).toBe('"issue-etag"');
        return Promise.resolve(
          new Response(null, {
            status: 304,
            headers: { etag: '"issue-etag-next"' },
          }),
        );
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const loadCursor = vi.fn((resourceType: string) =>
      Promise.resolve(
        resourceType === 'github.repo:acme/app:issues'
          ? {
              issues_since: '2026-06-10T12:00:00Z',
              github_conditional: {
                [`issues:${issuesPath}`]: { etag: '"issue-etag"' },
              },
            }
          : resourceType === 'github.repo:acme/app:releases' ||
              resourceType === 'github.repo:acme/app:workflow_runs'
            ? { last_polled_at: new Date().toISOString() }
            : {},
      ),
    );

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor,
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: 'issue.opened' })]),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:issues')).toMatchObject({
      issues_since: '2026-06-10T12:00:00Z',
      github_conditional: {
        [`issues:${issuesPath}`]: { etag: '"issue-etag-next"' },
      },
    });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname.endsWith('/issues');
      }),
    ).toHaveLength(1);
  });

  it('seeds the release timestamp cursor from a legacy draft release', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/releases')) {
        return Promise.resolve(jsonResponse([release(1, null)]));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const writeEvents = vi.fn<SyncContext['writeEvents']>().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents,
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ last_release_id: 1 }),
        persistTokens: vi.fn(),
      },
    });

    expect(writeEvents.mock.calls.flatMap(([events]) => events)).toEqual([
      expect.objectContaining({ eventType: 'release.draft' }),
    ]);
    expect(savedCursor(saveCursor, 'github.repo:acme/app:releases')).toMatchObject({
      last_release_id: 1,
      releases_since: '2026-06-01T00:00:00Z',
    });
  });

  it('truncates oversized initial commit history and advances the high-water cursor', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) {
        return Promise.resolve(
          jsonResponse(Array.from({ length: 100 }, (_, index) => commit(index + 1))),
        );
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(recordAudit).toHaveBeenCalledWith(
      'github_commit_history_truncated',
      expect.objectContaining({ repo: 'acme/app', pages: 20, highWaterSha: 'sha-001' }),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toMatchObject({
      last_sha: 'sha-001',
    });
  });

  it('checkpoints oversized commit gaps so later syncs can continue draining them', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) {
        return Promise.resolve(
          jsonResponse(Array.from({ length: 100 }, (_, index) => commit(index + 1))),
        );
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({ last_sha: 'sha-old' }),
        persistTokens: vi.fn(),
      },
    });

    expect(recordAudit).toHaveBeenCalledWith(
      'github_commit_gap_checkpoint',
      expect.objectContaining({
        repo: 'acme/app',
        targetSha: 'sha-old',
        highWaterSha: 'sha-001',
        until: '2026-06-10T10:40:01.000Z',
        oldestProcessedAt: '2026-06-10T10:40:00Z',
        pages: 20,
      }),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toMatchObject({
      last_sha: 'sha-old',
      commit_gap_target_sha: 'sha-old',
      commit_gap_high_water_sha: 'sha-001',
      commit_gap_until: '2026-06-10T10:40:01.000Z',
    });
  });

  it('continues a checkpointed commit gap and promotes the saved high-water sha', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/commits')) {
        return Promise.resolve(jsonResponse([commit(201), { ...commit(999), sha: 'sha-old' }]));
      }
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({
          last_sha: 'sha-old',
          commit_gap_target_sha: 'sha-old',
          commit_gap_high_water_sha: 'sha-001',
          commit_gap_until: '2026-06-10T10:00:00Z',
        }),
        persistTokens: vi.fn(),
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('&until=2026-06-10T10%3A00%3A00Z'),
      expect.any(Object),
    );
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toMatchObject({
      last_sha: 'sha-001',
      commit_gap_target_sha: undefined,
      commit_gap_high_water_sha: undefined,
      commit_gap_until: undefined,
    });
  });

  it('surfaces GitHub API failures instead of marking a broken sync healthy', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/issues')) {
        return Promise.resolve(jsonResponse({ message: 'rate limited' }, 403));
      }
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      const base = emptyGithubFetch(input);
      return Promise.resolve(base ?? jsonResponse({ message: 'unexpected' }, 404));
    });
    globalThis.fetch = fetchMock;
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    const recordAudit = vi.fn<SyncContext['recordAudit']>().mockResolvedValue(undefined);

    await githubProvider.incrementalSync({
      integration: {} as never,
      tokens: { access_token: 'gho_token' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit,
        saveCursor,
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    expect(savedCursor(saveCursor, 'github.repo:acme/app:issues')?.issues_since).toBeUndefined();
    const issuesStatus = savedStatus(saveCursor, 'github.repo:acme/app:issues');
    expect(issuesStatus).toMatchObject({
      lastStatus: 'error',
    });
    expect(issuesStatus?.lastError).toContain('GitHub GET');
    expect(savedCursor(saveCursor, 'github.repo:acme/app:commits')).toBeDefined();
    const auditPayload = recordAudit.mock.calls.find(
      ([kind]) => kind === 'github_incremental_partial',
    )?.[1];
    expect(typeof auditPayload?.summary === 'string' ? auditPayload.summary : undefined).toContain(
      'acme/app:issues:issues',
    );
  });
});
