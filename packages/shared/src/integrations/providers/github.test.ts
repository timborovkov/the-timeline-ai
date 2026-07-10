import { generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncContext } from '#src/integrations/index.js';

import { resetEnvForTests } from '#src/env.js';
import { GithubRateLimitError, githubProvider } from '#src/integrations/providers/github.js';

const ENV_BACKUP = { ...process.env };

interface TestGithubCursor {
  prs_since?: string;
  issues_since?: string;
  releases_since?: string;
  workflow_runs_since?: string;
  last_sha?: string;
  commit_gap_target_sha?: string;
  commit_gap_high_water_sha?: string;
  commit_gap_until?: string;
  last_polled_at?: string;
  github_conditional?: Record<string, { etag?: string; lastModified?: string }>;
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
      dedupKey: 'github:pr:7:2026-06-25T10:00:00Z',
      eventType: 'pr.updated',
      objectMap: { type: 'task', externalId: 'acme/app#7' },
    });
    expect(issueEvents[0]).toMatchObject({
      dedupKey: 'github:issue:8:2026-06-25T11:00:00Z',
      eventType: 'issue.updated',
      objectMap: { type: 'task', externalId: 'acme/app#issue:8' },
    });
    expect(reviewEvents[0]).toMatchObject({
      dedupKey: 'github:review:9:2026-06-25T12:00:00Z',
      eventType: 'pr.review.approved',
    });
    expect(releaseEvents[0]).toMatchObject({
      dedupKey: 'github:release:10:2026-06-25T13:00:00Z',
      eventType: 'release.published',
    });
    expect(workflowEvents[0]).toMatchObject({
      dedupKey: 'github:workflow_run:11:2026-06-25T14:00:00Z',
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
  ): {
    id: number;
    name: string | null;
    workflow_id: number;
    run_number: number;
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
      html_url: `https://github.com/acme/app/actions/runs/${String(id)}`,
      status: 'completed',
      conclusion: 'success',
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
        'github.repo:acme/api:releases',
        'github.repo:acme/api:commits',
        'github.repo:acme/api:workflow_runs',
        'github.repo:acme/app:prs',
        'github.repo:acme/app:issues',
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

    const commitsFailure = result?.partialFailures?.find(
      (failure) => failure.resource === repo && failure.surface === 'commits',
    );
    expect(commitsFailure?.error).toContain(
      'GitHub GET /repos/acme/super-long-repository-name-for-status-retention-tests/commits 404:',
    );
    expect(commitsFailure?.error).not.toContain('sha=main');
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
