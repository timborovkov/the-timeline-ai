import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const externalFetchCalls = vi.hoisted(() => vi.fn());

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: async (
    input: string | URL,
    init: RequestInit = {},
    options: { retries?: number } = {},
  ) => {
    externalFetchCalls(input, init, options);
    const method = (init.method ?? 'GET').toUpperCase();
    const retries = method === 'GET' || method === 'HEAD' ? (options.retries ?? 0) : 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await globalThis.fetch(input, init);
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
        if (attempt >= retries || (code !== 'timeout' && code !== 'network_failure')) throw error;
      }
    }
  },
}));

import type { IntegrationEvent } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { sentryProvider } from '#src/integrations/providers/sentry.js';

const ENV_BACKUP = { ...process.env };

function jsonResponse(body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('sentryProvider', () => {
  beforeEach(() => {
    externalFetchCalls.mockClear();
    process.env.SENTRY_INTEGRATION_CLIENT_ID = 'sentry-client';
    process.env.SENTRY_INTEGRATION_CLIENT_SECRET = 'sentry-secret';
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    vi.unstubAllGlobals();
  });

  function requestUrl(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  it('builds a Sentry OAuth authorize URL', async () => {
    const result = await sentryProvider.startOAuth({
      teamId: 'team-1',
      userId: 'user-1',
      redirectUri: 'https://timeline.test/api/integrations/sentry/callback',
      state: 'signed-state',
    });

    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://sentry.io/oauth/authorize/');
    expect(url.searchParams.get('client_id')).toBe('sentry-client');
    expect(url.searchParams.get('scope')).toContain('event:read');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('lists organizations and projects as syncable resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.endsWith('/organizations/')) {
          return Promise.resolve(jsonResponse([{ id: 'org-1', slug: 'acme', name: 'Acme' }]));
        }
        return Promise.resolve(jsonResponse([{ id: 'project-1', slug: 'web', name: 'Web' }]));
      }),
    );

    const resources = await sentryProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toEqual([
      { externalId: 'acme', label: 'Acme (all projects)', kind: 'sentry.org' },
      { externalId: 'acme/web', label: 'acme/web', kind: 'sentry.project' },
    ]);
  });

  it('refreshes expired Sentry tokens while listing syncable resources', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = requestUrl(input);
      if (url === 'https://sentry.io/oauth/token/') {
        const body = typeof init?.body === 'string' ? new URLSearchParams(init.body) : null;
        expect(body?.get('grant_type')).toBe('refresh_token');
        expect(body?.get('refresh_token')).toBe('refresh-old');
        return Promise.resolve(
          jsonResponse({
            access_token: 'token-new',
            refresh_token: 'refresh-new',
            expires_in: 3600,
          }),
        );
      }
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token-new' });
      if (url.endsWith('/organizations/')) {
        return Promise.resolve(jsonResponse([{ id: 'org-1', slug: 'acme', name: 'Acme' }]));
      }
      return Promise.resolve(jsonResponse([{ id: 'project-1', slug: 'web', name: 'Web' }]));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = { persistTokens: vi.fn().mockResolvedValue(undefined) };

    const resources = await sentryProvider.listSyncableResources(
      {} as never,
      {
        access_token: 'token-old',
        refresh_token: 'refresh-old',
        expires_at: Date.now() - 1_000,
      },
      ctx,
    );

    expect(resources).toEqual([
      { externalId: 'acme', label: 'Acme (all projects)', kind: 'sentry.org' },
      { externalId: 'acme/web', label: 'acme/web', kind: 'sentry.project' },
    ]);
    expect(ctx.persistTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'token-new',
        refresh_token: 'refresh-new',
      }),
    );
  });

  it('syncs issues and releases into incident events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 'issue-1',
                shortId: 'WEB-1',
                title: 'Checkout failed',
                status: 'unresolved',
                level: 'error',
                lastSeen: '2026-06-20T10:00:00Z',
                count: '3',
                userCount: 2,
                permalink: 'https://sentry.io/issues/issue-1',
              },
            ]),
          );
        }
        return Promise.resolve(
          jsonResponse([
            { version: 'web@1.2.3', dateCreated: '2026-06-20T11:00:00Z', newGroups: 1 },
          ]),
        );
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual(['issue.updated', 'release.created']);
    expect(events[0]?.dedupKey).toBe('sentry:issue:issue-1:open');
    expect(events[1]?.dedupKey).toBe('sentry:release:acme:web:web@1.2.3:created');
    expect(events[0]?.extra).toMatchObject({
      level: 'error',
      status: 'unresolved',
      count: '3',
      user_count: 2,
    });
    expect(events[0]?.objectMap).toMatchObject({
      type: 'incident',
      externalId: 'issue-1',
      priority: 'high',
      metadata: {
        level: 'error',
        status: 'unresolved',
        count: '3',
        user_count: 2,
      },
    });
    expect(events[1]?.objectMap).toMatchObject({
      type: 'other',
      canonicalName: 'Sentry release web@1.2.3',
      displayTitle: 'Release web@1.2.3',
      externalId: 'acme/web/release/web@1.2.3',
      status: 'done',
      aliases: ['web@1.2.3'],
      metadata: {
        sentry_record_kind: 'release',
        sentry_org_slug: 'acme',
        sentry_project_slug: 'web',
        release_version: 'web@1.2.3',
      },
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'sentry.project:acme/web',
      expect.objectContaining({ issues_since: '2026-06-20T10:00:00.000Z' }),
    );
  });

  it('refreshes expired Sentry tokens and persists the replacement before syncing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = requestUrl(input);
      if (url === 'https://sentry.io/oauth/token/') {
        const body = typeof init?.body === 'string' ? new URLSearchParams(init.body) : null;
        expect(body?.get('grant_type')).toBe('refresh_token');
        expect(body?.get('refresh_token')).toBe('refresh-old');
        return Promise.resolve(
          jsonResponse({
            access_token: 'token-new',
            refresh_token: 'refresh-new',
            expires_in: 3600,
          }),
        );
      }
      expect(init?.headers).toMatchObject({ authorization: 'Bearer token-new' });
      if (url.includes('/issues/')) return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn().mockResolvedValue(undefined),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: {
        access_token: 'token-old',
        refresh_token: 'refresh-old',
        expires_at: Date.now() - 1_000,
      },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx,
    });

    expect(ctx.persistTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'token-new',
        refresh_token: 'refresh-new',
      }),
    );
  });

  it('does not advance the issue cursor when no issues are returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(
          jsonResponse([{ version: 'web@1.2.3', dateCreated: '2026-06-20T11:00:00Z' }]),
        );
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx,
    });

    expect(ctx.saveCursor).toHaveBeenCalledWith('sentry.project:acme/web', {
      issues_since: undefined,
      releases_since: '2026-06-20T11:00:00.000Z',
      issue_lifecycles: {},
    });
  });

  it('follows Sentry Link pagination for project issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/') && !url.includes('cursor=page-2')) {
          return Promise.resolve(
            jsonResponse(
              [
                {
                  id: 'issue-1',
                  shortId: 'WEB-1',
                  title: 'Checkout failed',
                  lastSeen: '2026-06-20T10:00:00Z',
                },
              ],
              {
                link: '<https://sentry.io/api/0/projects/acme/web/issues/?cursor=page-2>; rel="next"; results="true"',
              },
            ),
          );
        }
        if (url.includes('/issues/') && url.includes('cursor=page-2')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 'issue-2',
                shortId: 'WEB-2',
                title: 'Cart failed',
                lastSeen: '2026-06-20T11:00:00Z',
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toEqual(['issue-1', 'issue-2']);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'sentry.project:acme/web',
      expect.objectContaining({ issues_since: '2026-06-20T11:00:00.000Z' }),
    );
  });

  it('filters releases by the stored release cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/')) return Promise.resolve(jsonResponse([]));
        return Promise.resolve(
          jsonResponse([
            { version: 'web@1.2.3', dateCreated: '2026-06-20T10:00:00Z' },
            { version: 'web@1.2.4', dateCreated: '2026-06-20T12:00:00Z' },
          ]),
        );
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        releases_since: '2026-06-20T11:00:00.000Z',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toEqual(['acme/web/release/web@1.2.4']);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'sentry.project:acme/web',
      expect.objectContaining({ releases_since: '2026-06-20T12:00:00.000Z' }),
    );
  });

  it('expands selected organizations to their projects before syncing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.endsWith('/organizations/acme/projects/')) {
          return Promise.resolve(jsonResponse([{ id: 'project-1', slug: 'web', name: 'Web' }]));
        }
        if (url.includes('/issues/')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 'issue-1',
                shortId: 'WEB-1',
                title: 'Checkout failed',
                status: 'unresolved',
                level: 'error',
                lastSeen: '2026-06-20T10:00:00Z',
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.org', externalId: 'acme' }],
      ctx,
    });

    expect(ctx.writeEvents).toHaveBeenCalledTimes(1);
    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toEqual(['issue-1']);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'sentry.project:acme/web',
      expect.objectContaining({ issues_since: '2026-06-20T10:00:00.000Z' }),
    );
  });

  it('retries a transient timeout while expanding selected organizations without duplicating events', async () => {
    const timeout = Object.assign(new Error('External request timed out after 30000ms'), {
      code: 'timeout',
    });
    let projectAttempts = 0;
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/organizations/acme/projects/')) {
        projectAttempts += 1;
        if (projectAttempts === 1) return Promise.reject(timeout);
        return Promise.resolve(jsonResponse([{ id: 'project-1', slug: 'web', name: 'Web' }]));
      }
      if (url.includes('/issues/')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'issue-1',
              shortId: 'WEB-1',
              title: 'Checkout failed',
              lastSeen: '2026-06-20T10:00:00Z',
            },
          ]),
        );
      }
      return Promise.resolve(jsonResponse([]));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await sentryProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.org', externalId: 'acme' }],
      ctx,
    });

    expect(projectAttempts).toBe(2);
    expect(externalFetchCalls).toHaveBeenCalledWith(
      'https://sentry.io/api/0/organizations/acme/projects/',
      expect.objectContaining({ headers: { authorization: 'Bearer token' } }),
      expect.objectContaining({ retries: 1 }),
    );
    expect(ctx.writeEvents).toHaveBeenCalledTimes(1);
    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toEqual(['issue-1']);
  });

  it('normalizes issue alert webhooks', async () => {
    const result = await sentryProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        action: 'triggered',
        actor: { id: 'sentry', name: 'Sentry' },
        organization: { slug: 'acme' },
        project: { slug: 'web' },
        data: {
          event: {
            issue_id: 'issue-1',
            title: 'Checkout failed',
            datetime: '2026-06-20T10:00:00Z',
            web_url: 'https://sentry.io/issues/issue-1',
          },
        },
      },
    });
    const normalized = Array.isArray(result) ? { events: result, syncTasks: [] } : result;

    expect(normalized?.events[0]).toMatchObject({
      dedupKey: 'sentry:issue:issue-1:open',
      eventType: 'alert.triggered',
      objectMap: {
        type: 'incident',
        externalId: 'issue-1',
        metadata: {
          sentry_org_slug: 'acme',
          sentry_project_slug: 'web',
          sentry_issue_id: 'issue-1',
          webhook_action: 'triggered',
        },
      },
    });
    expect(normalized?.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'sentry.project',
        externalId: 'acme/web',
        reason: 'sentry_project_webhook',
      },
    ]);
  });

  it('mints a distinct regression dedup key when a resolved issue becomes unresolved', async () => {
    const loadCursor = vi
      .fn()
      .mockResolvedValueOnce({
        issue_lifecycles: { 'issue-1': 'resolved' },
      })
      .mockResolvedValue({});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 'issue-1',
                shortId: 'WEB-1',
                title: 'Checkout failed',
                status: 'unresolved',
                level: 'error',
                lastSeen: '2026-06-22T08:00:00Z',
                count: '41',
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const writeEvents = vi.fn().mockResolvedValue([]);
    const saveCursor = vi.fn().mockResolvedValue(undefined);
    await sentryProvider.incrementalSync?.({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx: {
        loadCursor,
        saveCursor,
        writeEvents,
        persistTokens: vi.fn(),
        recordAudit: vi.fn(),
      },
    });
    const syncEvents = (writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(syncEvents[0]?.dedupKey).toBe('sentry:issue:issue-1:regressed:2026-06-22T08:00:00.000Z');
    expect(syncEvents[0]?.eventType).toBe('issue.regressed');

    const webhook = await sentryProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        action: 'unresolved',
        organization: { slug: 'acme' },
        data: {
          issue: {
            id: 'issue-1',
            shortId: 'WEB-1',
            title: 'Checkout failed',
            status: 'unresolved',
            level: 'error',
            lastSeen: '2026-06-22T09:00:00Z',
            permalink: 'https://sentry.io/issues/issue-1',
            project: { slug: 'web' },
          },
        },
      },
    });
    const normalized = Array.isArray(webhook) ? { events: webhook } : (webhook ?? { events: [] });
    expect(normalized.events[0]?.dedupKey).toBe(
      'sentry:issue:issue-1:regressed:2026-06-22T09:00:00.000Z',
    );
    expect(normalized.events[0]?.eventType).toBe('issue.regressed');
  });

  it('keeps one open-issue dedup key across lastSeen and alert timestamp churn', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((input) => {
        const url = requestUrl(input);
        if (url.includes('/issues/')) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 'issue-1',
                shortId: 'WEB-1',
                title: 'Checkout failed',
                status: 'unresolved',
                level: 'error',
                lastSeen: '2026-06-20T10:00:00Z',
                count: '3',
              },
              {
                id: 'issue-1',
                shortId: 'WEB-1',
                title: 'Checkout failed',
                status: 'unresolved',
                level: 'error',
                lastSeen: '2026-06-21T08:00:00Z',
                count: '40',
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const writeEvents = vi.fn().mockResolvedValue([]);
    await sentryProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'sentry.project', externalId: 'acme/web' }],
      ctx: {
        loadCursor: vi.fn().mockResolvedValue({}),
        saveCursor: vi.fn().mockResolvedValue(undefined),
        writeEvents,
        persistTokens: vi.fn(),
        recordAudit: vi.fn(),
      },
    });
    const syncEvents = (writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(syncEvents.map((event) => event.dedupKey)).toEqual([
      'sentry:issue:issue-1:open',
      'sentry:issue:issue-1:open',
    ]);

    const alertDedupKeys = [];
    for (const datetime of ['2026-06-20T10:00:00Z', '2026-06-21T09:00:00Z']) {
      const result = await sentryProvider.handleWebhook?.({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        payload: {
          action: 'triggered',
          organization: { slug: 'acme' },
          project: { slug: 'web' },
          data: {
            event: {
              issue_id: 'issue-1',
              title: 'Checkout failed',
              datetime,
            },
          },
        },
      });
      const normalized = Array.isArray(result) ? { events: result } : (result ?? { events: [] });
      alertDedupKeys.push(normalized.events[0]?.dedupKey);
    }
    expect(alertDedupKeys).toEqual(['sentry:issue:issue-1:open', 'sentry:issue:issue-1:open']);
  });

  it('normalizes issue lifecycle webhooks from Sentry issue payloads', async () => {
    const result = await sentryProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        action: 'resolved',
        actor: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
        organization: { slug: 'acme' },
        data: {
          issue: {
            id: 'issue-1',
            shortId: 'WEB-1',
            title: 'Checkout failed',
            status: 'resolved',
            level: 'error',
            count: '7',
            userCount: 3,
            lastSeen: '2026-06-20T10:00:00Z',
            permalink: 'https://sentry.io/organizations/acme/issues/issue-1/',
            project: { slug: 'web' },
            metadata: { type: 'Error', value: 'Checkout failed' },
          },
        },
      },
    });
    const normalized = Array.isArray(result) ? { events: result, syncTasks: [] } : result;

    expect(normalized?.events[0]).toMatchObject({
      dedupKey: 'sentry:issue:issue-1:resolved',
      eventType: 'issue.resolved',
      actor: { externalId: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      extra: {
        sentry_org_slug: 'acme',
        sentry_project_slug: 'web',
        sentry_short_id: 'WEB-1',
        webhook_action: 'resolved',
        level: 'error',
        status: 'resolved',
        count: '7',
        user_count: 3,
      },
      objectMap: {
        type: 'incident',
        externalId: 'issue-1',
        status: 'done',
        priority: 'high',
        aliases: ['WEB-1'],
        metadata: {
          level: 'error',
          status: 'resolved',
          count: '7',
          user_count: 3,
        },
      },
    });
    expect(normalized?.events[0]?.contentText).toContain('Sentry issue resolved: WEB-1');
    expect(normalized?.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'sentry.project',
        externalId: 'acme/web',
        reason: 'sentry_project_webhook',
      },
    ]);
  });

  it('normalizes release webhooks from Sentry release payloads', async () => {
    const result = await sentryProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        action: 'deployed',
        organization: { slug: 'acme' },
        data: {
          release: {
            version: 'web@1.2.4',
            dateReleased: '2026-06-20T12:00:00Z',
            newGroups: 2,
            url: 'https://sentry.io/organizations/acme/projects/web/releases/web@1.2.4/',
            projects: [{ slug: 'web' }],
          },
        },
      },
    });
    const normalized = Array.isArray(result) ? { events: result, syncTasks: [] } : result;

    expect(normalized?.events[0]).toMatchObject({
      dedupKey: 'sentry:release:acme:web:web@1.2.4:deployed',
      eventType: 'release.deployed',
      externalObjectId: 'acme/web/release/web@1.2.4',
      extra: {
        sentry_org_slug: 'acme',
        sentry_project_slug: 'web',
        release_version: 'web@1.2.4',
        webhook_action: 'deployed',
        new_groups: 2,
      },
    });
    expect(normalized?.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'sentry.project',
        externalId: 'acme/web',
        reason: 'sentry_project_webhook',
      },
    ]);
  });
});
