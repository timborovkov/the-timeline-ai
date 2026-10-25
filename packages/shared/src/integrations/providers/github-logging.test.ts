import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ExternalFetch from '#src/http/external-fetch.js';

const warn = vi.hoisted(() => vi.fn());

vi.mock('#src/logger.js', () => ({
  childLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('#src/http/external-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ExternalFetch>();
  return {
    ...actual,
    externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

import { githubProvider } from '#src/integrations/providers/github.js';

const ENV_BACKUP = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('github fetch logging', () => {
  beforeEach(() => {
    warn.mockReset();
    process.env.GITHUB_APP_CLIENT_ID = 'client-id';
    process.env.GITHUB_APP_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    vi.unstubAllGlobals();
  });

  it('labels a 404 repo fetch as access_revoked with connection ids in the message text', async () => {
    globalThis.fetch = vi.fn<typeof fetch>((input) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      if (url.pathname.endsWith('/pulls')) {
        return Promise.resolve(jsonResponse({ message: 'Not Found' }, 404));
      }
      if (url.pathname.endsWith('/issues')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/issues/comments')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/pulls/comments')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/releases')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/commits')) return Promise.resolve(jsonResponse([]));
      if (url.pathname.endsWith('/actions/runs')) {
        return Promise.resolve(jsonResponse({ workflow_runs: [] }));
      }
      if (url.pathname === '/repos/acme/lost-repo') {
        return Promise.resolve(
          jsonResponse({
            id: 9,
            full_name: 'acme/lost-repo',
            name: 'lost-repo',
            owner: { login: 'acme' },
            private: true,
            default_branch: 'main',
          }),
        );
      }
      return Promise.resolve(jsonResponse({ message: 'unexpected' }, 404));
    });

    await githubProvider.incrementalSync({
      integration: {
        id: '11111111-1111-4111-8111-111111111111',
        teamId: 'team-1',
      } as never,
      tokens: {
        access_token: 'gho_token',
        github_installation_id: '4242',
      },
      selections: [{ kind: 'github.repo', externalId: 'acme/lost-repo' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn(),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    const prLine = warn.mock.calls
      .map((call) => String(call[1]))
      .find((message) => message.includes('github PR fetch failed'));
    expect(prLine).toContain('access_revoked');
    expect(prLine).toContain('integration=11111111-1111-4111-8111-111111111111');
    expect(prLine).toContain('installation=4242');
    expect(prLine).toContain('repo=acme/lost-repo');
    expect(prLine).not.toContain('gho_token');
  });

  it('puts ExternalHttpError code and cause chain in the github fetch failed message', async () => {
    const { ExternalHttpError } = await import('#src/http/external-fetch.js');
    const leaf = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '140.82.112.6',
    });
    globalThis.fetch = vi.fn<typeof fetch>(() =>
      Promise.reject(
        new ExternalHttpError('network_failure', 'External request failed', { cause: leaf }),
      ),
    );

    await githubProvider.incrementalSync({
      integration: { id: '22222222-2222-4222-8222-222222222222' } as never,
      tokens: { access_token: 'gho_token', github_installation_id: '99' },
      selections: [{ kind: 'github.repo', externalId: 'acme/app' }],
      ctx: {
        writeEvents: vi.fn().mockResolvedValue([]),
        recordAudit: vi.fn(),
        saveCursor: vi.fn(),
        loadCursor: vi.fn().mockResolvedValue({}),
        persistTokens: vi.fn(),
      },
    });

    const line = warn.mock.calls
      .map((call) => String(call[1]))
      .find((message) => message.includes('github PR fetch failed'));
    expect(line).toContain('network_failure');
    expect(line).toContain('integration=22222222-2222-4222-8222-222222222222');
    expect(line).toContain('installation=99');
    expect(line).toContain('ECONNREFUSED');
    expect(line).toContain('syscall=connect');
  });
});
