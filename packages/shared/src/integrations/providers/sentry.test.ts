import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    expect(events[0]?.objectMap).toMatchObject({
      type: 'incident',
      externalId: 'issue-1',
      priority: 'high',
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
      releases_since: '2026-06-20T11:00:00.000Z',
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

  it('normalizes issue alert webhooks', async () => {
    const events = await sentryProvider.handleWebhook?.({
      integration: { id: 'integration-1' } as never,
      payload: {
        action: 'triggered',
        actor: { id: 'sentry', name: 'Sentry' },
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

    expect(events?.[0]).toMatchObject({
      dedupKey: 'sentry:webhook:issue-1:2026-06-20T10:00:00.000Z:triggered',
      eventType: 'alert.triggered',
      objectMap: { type: 'incident', externalId: 'issue-1' },
    });
  });
});
