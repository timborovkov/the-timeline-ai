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

describe('githubProvider.listSyncableResources', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

describe('githubProvider.incrementalSync', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ last_sha: 'sha-001' }),
    );
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
      new Set(['github.repo:acme/api', 'github.repo:acme/app']),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const requestUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        return new URL(requestUrl).pathname === '/repos/acme/app';
      }),
    ).toHaveLength(1);
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

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn(),
          saveCursor,
          loadCursor: vi.fn().mockResolvedValue({ since: '2026-06-10T10:00:00Z' }),
          persistTokens: vi.fn(),
        },
      }),
    ).rejects.toThrow('github_incremental_partial');
    expect(
      saveCursor.mock.calls.some(([, cursor]) => Boolean((cursor as TestGithubCursor).prs_since)),
    ).toBe(false);
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
    ).rejects.toThrow('Pull requests read permission required');
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ releases_since: '2026-06-10T12:00:00Z' }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({
        last_release_id: 1,
        releases_since: '2026-06-10T12:00:00Z',
      }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ releases_since: '2026-06-10T13:00:00Z' }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ workflow_runs_since: '2026-06-10T12:00:00Z' }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ issues_since: '2026-06-10T13:08:00Z' }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({
        last_release_id: 1,
        releases_since: '2026-06-01T00:00:00Z',
      }),
    );
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({ last_sha: 'sha-001' }),
    );
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
    const checkpointCursor = saveCursor.mock.calls.at(-1)?.[1] as TestGithubCursor | undefined;
    expect(checkpointCursor).toMatchObject({
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
    expect(saveCursor).toHaveBeenCalledWith(
      'github.repo:acme/app',
      expect.objectContaining({
        last_sha: 'sha-001',
        commit_gap_target_sha: undefined,
        commit_gap_high_water_sha: undefined,
        commit_gap_until: undefined,
      }),
    );
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

    await expect(
      githubProvider.incrementalSync({
        integration: {} as never,
        tokens: { access_token: 'gho_token' },
        selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
        ctx: {
          writeEvents: vi.fn().mockResolvedValue([]),
          recordAudit: vi.fn(),
          saveCursor,
          loadCursor: vi.fn().mockResolvedValue({}),
          persistTokens: vi.fn(),
        },
      }),
    ).rejects.toThrow('github_incremental_partial');
    expect(
      saveCursor.mock.calls.some(([, cursor]) =>
        Boolean((cursor as TestGithubCursor).issues_since),
      ),
    ).toBe(false);
  });
});
