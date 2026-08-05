import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import type { IntegrationEvent } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { mondayProvider } from '#src/integrations/providers/monday.js';
import { ProviderRateLimitError } from '#src/integrations/types.js';

const ENV_BACKUP = { ...process.env };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestPayload(init: RequestInit | undefined): {
  query: string;
  variables?: Record<string, unknown>;
} {
  if (typeof init?.body !== 'string') throw new Error('expected JSON request body');
  const payload = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> };
  expect(payload.query).not.toMatch(/\bemail\b/);
  expect(payload.query).not.toMatch(/column_values\s*{[^}]*\bupdated_at\b/);
  return payload;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('mondayProvider', () => {
  beforeEach(() => {
    process.env.MONDAY_CLIENT_ID = 'monday-client';
    process.env.MONDAY_CLIENT_SECRET = 'monday-secret';
    resetEnvForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    vi.unstubAllGlobals();
  });

  it('builds a monday.com OAuth authorize URL', async () => {
    const result = await mondayProvider.startOAuth({
      teamId: 'team-1',
      userId: 'user-1',
      redirectUri: 'https://timeline.test/api/integrations/monday/callback',
      state: 'signed-state',
    });

    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://auth.monday.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('monday-client');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://timeline.test/api/integrations/monday/callback',
    );
    expect(url.searchParams.get('scope')).toBe(
      'boards:read users:read updates:read docs:read account:read webhooks:read webhooks:write',
    );
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('exchanges a monday.com OAuth code and labels the connection from the viewer', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) === 'https://auth.monday.com/oauth2/token') {
        const body = typeof init?.body === 'string' ? new URLSearchParams(init.body) : null;
        expect(body?.get('grant_type')).toBe('authorization_code');
        expect(body?.get('code')).toBe('oauth-code');
        expect(body?.get('redirect_uri')).toBe(
          'https://timeline.test/api/integrations/monday/callback',
        );
        return Promise.resolve(
          jsonResponse({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
          }),
        );
      }

      expect(new Headers(init?.headers).get('api-version')).toBe('2026-04');
      const body = requestPayload(init);
      if (body.query === 'query { account { id slug } }') {
        return Promise.resolve(
          jsonResponse({
            data: {
              account: { id: 'account-1', slug: 'acme' },
            },
          }),
        );
      }
      expect(body.query).toBe('query { me { id name } }');
      return Promise.resolve(
        jsonResponse({
          data: {
            me: { id: 'user-1', name: 'Ada Lovelace' },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    const result = await mondayProvider.handleOAuthCallback({
      code: 'oauth-code',
      redirectUri: 'https://timeline.test/api/integrations/monday/callback',
    });

    expect(result).toMatchObject({
      externalAccountId: 'account-1',
      displayName: 'Monday.com — acme',
      scopes: [
        'boards:read',
        'users:read',
        'updates:read',
        'docs:read',
        'account:read',
        'webhooks:read',
        'webhooks:write',
      ],
    });
    expect(result.tokens).toMatchObject({
      access_token: 'token',
      refresh_token: 'refresh',
    });
  });

  it('connects monday.com from token metadata when the viewer query is unauthorized', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) === 'https://auth.monday.com/oauth2/token') {
        return Promise.resolve(
          jsonResponse({
            access_token: 'token',
            account_id: 'account-1',
          }),
        );
      }

      const body = requestPayload(init);
      if (body.query === 'query { account { id slug } }') {
        return Promise.resolve(
          jsonResponse({ errors: [{ message: 'Unauthorized field or type' }] }),
        );
      }
      expect(body.query).toBe('query { me { id name } }');
      return Promise.resolve(jsonResponse({ errors: [{ message: 'Unauthorized field or type' }] }));
    });
    vi.stubGlobal('fetch', fetch);

    const result = await mondayProvider.handleOAuthCallback({
      code: 'oauth-code',
      redirectUri: 'https://timeline.test/api/integrations/monday/callback',
    });

    expect(result.externalAccountId).toBe('account-1');
    expect(result.displayName).toBe('Monday.com — account-1');
  });

  it('does not ignore non-workspace monday.com missing-scope errors during OAuth', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) === 'https://auth.monday.com/oauth2/token') {
        return Promise.resolve(
          jsonResponse({
            access_token: 'token',
            account_id: 'account-1',
          }),
        );
      }

      const body = requestPayload(init);
      if (body.query === 'query { account { id slug } }') {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message:
                  "Unauthorized to load field 'Query.account', Reason: missing required scopes.",
              },
            ],
          }),
        );
      }
      expect(body.query).toBe('query { me { id name } }');
      return Promise.resolve(jsonResponse({ data: { me: { id: 'user-1', name: 'Ada' } } }));
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      mondayProvider.handleOAuthCallback({
        code: 'oauth-code',
        redirectUri: 'https://timeline.test/api/integrations/monday/callback',
      }),
    ).rejects.toThrow(/Query\.account/);
  });

  it('lists boards and WorkDocs as syncable resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('boards(limit: $limit')) {
          expect(body.variables).toMatchObject({ limit: 100, page: 1 });
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'Launch',
                    workspace: { id: 'workspace-1', name: 'Product' },
                  },
                ],
              },
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            data: {
              docs: [
                {
                  id: 'doc-1',
                  name: 'Launch notes',
                  workspace: { id: 'workspace-1', name: 'Product' },
                },
              ],
            },
          }),
        );
      }),
    );

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources[0]).toMatchObject({
      externalId: 'board-1',
      label: 'Product / Launch',
      kind: 'monday.board',
    });
    expect(resources[0]?.searchText).toContain('subitems');
    expect(resources[1]).toMatchObject({
      externalId: 'doc-1',
      label: 'Product / Launch notes',
      kind: 'monday.doc',
    });
    expect(resources[1]?.searchText).toContain('workdocs');
  });

  it('surfaces monday.com daily quota exhaustion with provider retry metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T02:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  message: 'Daily limit exceeded',
                  extensions: {
                    code: 'DAILY_LIMIT_EXCEEDED',
                    retry_in_seconds: 120,
                  },
                },
              ],
            }),
            {
              status: 429,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
      ),
    );

    await expect(
      mondayProvider.listSyncableResources({} as never, {
        access_token: 'token',
      }),
    ).rejects.toMatchObject({
      provider: 'monday',
      retryAt: new Date('2026-06-25T02:02:00.000Z'),
      retryAfterSeconds: 120,
      scope: 'daily',
      reason: 'daily_limit_exceeded',
    });
    await expect(
      mondayProvider.listSyncableResources({} as never, {
        access_token: 'token',
      }),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('normalizes monday.com board webhook payloads into lightweight events', async () => {
    const result = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          columnId: 'status',
          columnType: 'color',
          columnTitle: 'Status',
          value: { label: 'Done' },
          previousValue: { label: 'Working on it' },
          type: 'update_column_value',
          triggerTime: '2026-06-25T09:15:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: '645fc8d8709d35718f1ae00ceded91e9',
        },
      },
    });
    const normalized = Array.isArray(result) ? { events: result, syncTasks: [] } : result;

    expect(normalized?.events[0]).toMatchObject({
      dedupKey: 'monday:item:1771812698:1771812728:done',
      eventType: 'column.changed',
      externalObjectId: '1771812728',
      externalEventId: '645fc8d8709d35718f1ae00ceded91e9',
      objectMap: {
        type: 'other',
        externalId: '1771812728',
        status: 'done',
      },
      extra: {
        monday_board_id: '1771812698',
        monday_item_id: '1771812728',
        monday_subscription_id: '73760484',
        monday_trigger_uuid: '645fc8d8709d35718f1ae00ceded91e9',
      },
    });
    expect(normalized?.events[0]?.contentText).toContain('Column: Status');
    expect(normalized?.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'monday.item',
        externalId: '1771812698:1771812728',
        surface: 'column.changed',
        reason: 'monday_item_webhook',
      },
    ]);
  });

  it('mints revision keys for Monday update edit/delete webhooks', async () => {
    const created = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          updateId: 55,
          type: 'create_update',
          triggerTime: '2026-06-25T09:15:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });
    const edited = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          updateId: 55,
          type: 'edit_update',
          triggerTime: '2026-06-25T09:20:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      },
    });
    const createdEvents = Array.isArray(created) ? created : (created?.events ?? []);
    const editedEvents = Array.isArray(edited) ? edited : (edited?.events ?? []);
    expect(createdEvents[0]?.dedupKey).toBe(
      'monday:update:1771812728:55:create_update:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(editedEvents[0]?.dedupKey).toBe(
      'monday:update:1771812728:55:edit_update:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(editedEvents[0]?.dedupKey).not.toBe(createdEvents[0]?.dedupKey);
  });

  it('uses distinct lifecycle buckets for Monday archive and delete webhooks', async () => {
    const archived = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          type: 'item_archived',
          triggerTime: '2026-06-25T09:15:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: 'cccccccccccccccccccccccccccccccc',
        },
      },
    });
    const deleted = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          type: 'item_deleted',
          triggerTime: '2026-06-25T09:16:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: 'dddddddddddddddddddddddddddddddd',
        },
      },
    });
    const archivedEvents = Array.isArray(archived) ? archived : (archived?.events ?? []);
    const deletedEvents = Array.isArray(deleted) ? deleted : (deleted?.events ?? []);
    expect(archivedEvents[0]?.dedupKey).toBe('monday:item:1771812698:1771812728:archived');
    expect(deletedEvents[0]?.dedupKey).toBe('monday:item:1771812698:1771812728:deleted');
    expect(archivedEvents[0]?.objectMap).toMatchObject({ status: 'cancelled' });
    expect(deletedEvents[0]?.objectMap).toMatchObject({ status: 'cancelled' });
  });

  it('does not derive lifecycle status from non-status Monday column webhooks', async () => {
    const result = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          userId: 9603417,
          boardId: 1771812698,
          pulseId: 1771812728,
          pulseName: 'Launch checklist',
          columnId: 'person',
          columnType: 'multiple-person',
          columnTitle: 'Owner',
          value: { personsAndTeams: [{ id: 1, kind: 'person' }] },
          previousValue: null,
          type: 'update_column_value',
          triggerTime: '2026-06-25T09:15:03.429Z',
          subscriptionId: 73760484,
          triggerUuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      },
    });
    const normalized = Array.isArray(result) ? { events: result, syncTasks: [] } : result;

    expect(normalized?.events[0]).toMatchObject({
      dedupKey: 'monday:item:1771812698:1771812728:observed',
      eventType: 'column.changed',
      objectMap: {
        type: 'other',
        externalId: '1771812728',
      },
    });
    expect(normalized?.events[0]?.objectMap).not.toHaveProperty('status');
  });

  it('keeps the same Monday item dedup key across same-lifecycle webhook churn', async () => {
    const payload = {
      event: {
        userId: 9603417,
        boardId: 1771812698,
        pulseId: 1771812728,
        pulseName: 'Launch checklist',
        columnId: 'status',
        columnType: 'color',
        columnTitle: 'Status',
        value: { label: 'Done' },
        previousValue: { label: 'Working on it' },
        type: 'update_column_value',
        triggerTime: '2026-06-25T09:15:03.429Z',
        subscriptionId: 73760484,
        triggerUuid: '645fc8d8709d35718f1ae00ceded91e9',
      },
    };
    const first = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload,
    });
    const second = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          ...payload.event,
          triggerTime: '2026-06-25T10:15:03.429Z',
          triggerUuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pulseName: 'Launch checklist (renamed)',
        },
      },
    });
    const firstEvent = (Array.isArray(first) ? first[0] : first?.events[0]) ?? null;
    const secondEvent = (Array.isArray(second) ? second[0] : second?.events[0]) ?? null;
    expect(firstEvent?.dedupKey).toBe('monday:item:1771812698:1771812728:done');
    expect(secondEvent?.dedupKey).toBe(firstEvent?.dedupKey);
    expect(secondEvent?.externalEventId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(secondEvent?.contentText).toContain('renamed');
  });

  it('routes classic subitem webhooks through the selected parent board', async () => {
    const normalized = await mondayProvider.handleWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      payload: {
        event: {
          boardId: 1772135370,
          parentItemBoardId: 1771812698,
          parentItemId: 1771812716,
          pulseId: 1772139123,
          pulseName: 'sub-item',
          type: 'create_pulse',
          triggerTime: '2021-10-11T09:24:51.835Z',
          subscriptionId: 73761697,
          triggerUuid: 'subitem-trigger',
        },
      },
    });
    if (!normalized || Array.isArray(normalized)) throw new Error('Expected normalized webhook');

    expect(normalized.events[0]).toMatchObject({
      eventType: 'subitem.created',
      externalObjectId: '1772139123',
      extra: {
        monday_board_id: '1771812698',
        monday_item_board_id: '1772135370',
        monday_parent_item_id: '1771812716',
      },
      objectMap: {
        metadata: {
          monday_record_kind: 'subitem',
          monday_board_id: '1771812698',
          monday_item_board_id: '1772135370',
          monday_parent_item_id: '1771812716',
        },
      },
    });
    expect(normalized.syncTasks).toEqual([
      {
        integrationId: 'integration-1',
        teamId: 'team-1',
        triggeredBy: 'webhook',
        resourceType: 'monday.item',
        externalId: '1771812698:1772139123',
        surface: 'subitem.created',
        reason: 'monday_item_webhook',
      },
    ]);
  });

  it('provisions monday.com board webhooks for selected boards', async () => {
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.MONDAY_WEBHOOK_SECRET = 'webhook-secret';
    resetEnvForTests();
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('boards(ids: $ids)')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  type: 'board',
                  board_kind: 'public',
                  hierarchy_type: 'classic',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      expect(body.query).toContain('create_webhook');
      const variables = body.variables ?? {};
      expect(variables.boardId).toBe('board-1');
      expect(variables.url).toBe('https://timeline.test/api/webhooks/monday?token=webhook-secret');
      return Promise.resolve(
        jsonResponse({
          data: {
            create_webhook: {
              id: `hook-${String(variables.event)}`,
              board_id: 'board-1',
            },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    const active = await mondayProvider.provisionWebhooks?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      existingSubscriptions: [
        {
          externalSubscriptionId: 'existing-create-item-hook',
          resourceKind: 'monday.board',
          externalResourceId: 'board-1',
          eventType: 'create_item',
          expiresAt: null,
        },
      ],
    });

    expect(active).toHaveLength(12);
    expect(active).toContainEqual({
      externalSubscriptionId: 'existing-create-item-hook',
      resourceKind: 'monday.board',
      externalResourceId: 'board-1',
      eventType: 'create_item',
    });
    expect(active).toContainEqual({
      externalSubscriptionId: 'hook-change_column_value',
      resourceKind: 'monday.board',
      externalResourceId: 'board-1',
      eventType: 'change_column_value',
      expiresAt: null,
    });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it('does not attempt to provision webhooks on a persisted classic subitems board selection', async () => {
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.MONDAY_WEBHOOK_SECRET = 'webhook-secret';
    resetEnvForTests();
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('create_webhook')) {
        throw new Error('must not create a webhook on a subitems board');
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            boards: [
              {
                id: 'subitems-board-1',
                name: 'Subitems of Pipeline',
                type: 'sub_items_board',
                board_kind: 'public',
                hierarchy_type: 'classic',
                columns: [],
              },
            ],
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    const active = await mondayProvider.provisionWebhooks?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'subitems-board-1' }],
      existingSubscriptions: [],
    });

    expect(active).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('continues provisioning valid boards when monday rejects a stale helper board', async () => {
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.MONDAY_WEBHOOK_SECRET = 'webhook-secret';
    resetEnvForTests();
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      const variables = body.variables ?? {};
      if (body.query.includes('boards(ids: $ids)')) {
        const boardId = String((variables.ids as string[] | undefined)?.[0]);
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: boardId,
                  name: boardId === 'stale-helper' ? 'Subitems of Pipeline' : 'Pipeline',
                  type: 'board',
                  board_kind: 'public',
                  hierarchy_type: 'classic',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (variables.boardId === 'stale-helper') {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: "Creating webhook on subitems board isn't allowed",
                extensions: { code: 'InvalidArgumentException' },
              },
            ],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            create_webhook: {
              id: `hook-${String(variables.event)}`,
              board_id: 'board-1',
            },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    const active = await mondayProvider.provisionWebhooks?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'token' },
      selections: [
        { kind: 'monday.board', externalId: 'stale-helper' },
        { kind: 'monday.board', externalId: 'board-1' },
      ],
      existingSubscriptions: [],
    });

    expect(active).toHaveLength(12);
    expect(active?.every((subscription) => subscription.externalResourceId === 'board-1')).toBe(
      true,
    );
  });

  it('persists each created monday.com webhook before creating the next one', async () => {
    process.env.AUTH_URL = 'https://timeline.test';
    process.env.MONDAY_WEBHOOK_SECRET = 'webhook-secret';
    resetEnvForTests();
    const persisted: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('boards(ids: $ids)')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  type: 'board',
                  board_kind: 'public',
                  hierarchy_type: 'classic',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      expect(body.query).toContain('create_webhook');
      const variables = body.variables ?? {};
      if (variables.event === 'change_column_value') {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message: 'Daily limit exceeded',
                extensions: { code: 'DAILY_LIMIT_EXCEEDED', retry_in_seconds: 60 },
              },
            ],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            create_webhook: {
              id: `hook-${String(variables.event)}`,
              board_id: 'board-1',
            },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      mondayProvider.provisionWebhooks?.({
        integration: { id: 'integration-1', teamId: 'team-1' } as never,
        tokens: { access_token: 'token' },
        selections: [{ kind: 'monday.board', externalId: 'board-1' }],
        existingSubscriptions: [],
        ctx: {
          persistTokens: vi.fn(),
          persistWebhookSubscription: (subscription) => {
            persisted.push(subscription);
            return Promise.resolve();
          },
        },
      }),
    ).rejects.toBeInstanceOf(ProviderRateLimitError);

    expect(persisted).toEqual([
      {
        externalSubscriptionId: 'hook-create_item',
        resourceKind: 'monday.board',
        externalResourceId: 'board-1',
        eventType: 'create_item',
        expiresAt: null,
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('deprovisions stale monday.com webhooks', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      expect(body.query).toContain('delete_webhook');
      expect(body.variables).toEqual({ id: 'hook-1' });
      return Promise.resolve(
        jsonResponse({
          data: {
            delete_webhook: { id: 'hook-1', board_id: 'board-1' },
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);

    await mondayProvider.deprovisionWebhook?.({
      integration: { id: 'integration-1', teamId: 'team-1' } as never,
      tokens: { access_token: 'token' },
      subscription: {
        externalSubscriptionId: 'hook-1',
        resourceKind: 'monday.board',
        externalResourceId: 'board-1',
        eventType: 'create_item',
      },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('hides monday.com subitem boards from source sharing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('boards(limit: $limit')) {
          expect(body.query).toContain('hierarchy_types: [classic, multi_level]');
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'KIESI',
                    board_kind: 'public',
                    type: 'board',
                    workspace: null,
                  },
                  {
                    id: 'subitems-board-1',
                    name: 'Subitems of KIESI',
                    board_kind: 'public',
                    type: 'sub_items_board',
                    workspace: null,
                  },
                  {
                    id: 'real-board-with-subitems-name',
                    name: 'Subitems of Marketing',
                    board_kind: 'public',
                    type: 'board',
                    workspace: null,
                  },
                  {
                    id: 'localized-subitems-board-1',
                    name: 'Alitehtävät KIESI',
                    board_kind: 'sub_items_board',
                    workspace: null,
                  },
                  {
                    id: 'multi-level-board-1',
                    name: 'Portfolio projects',
                    type: 'board',
                    board_kind: 'public',
                    hierarchy_type: 'multi_level',
                    workspace: null,
                  },
                ],
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: { docs: [] } }));
      }),
    );

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toHaveLength(3);
    expect(resources[0]).toMatchObject({
      externalId: 'board-1',
      label: 'KIESI',
      kind: 'monday.board',
    });
    expect(resources[0]?.searchText).toContain('subitems');
    expect(resources[1]).toMatchObject({
      externalId: 'real-board-with-subitems-name',
      label: 'Subitems of Marketing',
      kind: 'monday.board',
    });
    expect(resources[2]).toMatchObject({
      externalId: 'multi-level-board-1',
      label: 'Portfolio projects',
      kind: 'monday.board',
    });
  });

  it('persists refreshed monday.com tokens while listing syncable resources', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) === 'https://auth.monday.com/oauth2/token') {
        return Promise.resolve(
          jsonResponse({
            access_token: 'token-new',
            refresh_token: 'refresh-new',
            expires_in: 3600,
          }),
        );
      }
      expect(init?.headers).toMatchObject({ authorization: 'token-new' });
      const body = requestPayload(init);
      if (body.query.includes('boards(limit: $limit')) {
        expect(body.variables).toMatchObject({ limit: 100, page: 1 });
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [{ id: 'board-1', name: 'Launch', workspace: null }],
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { docs: [] } }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = { persistTokens: vi.fn().mockResolvedValue(undefined) };

    const resources = await mondayProvider.listSyncableResources(
      {} as never,
      {
        access_token: 'token-old',
        refresh_token: 'refresh-old',
        expires_at: Date.now() - 1_000,
      },
      ctx,
    );

    expect(resources).toEqual([
      expect.objectContaining({ externalId: 'board-1', label: 'Launch', kind: 'monday.board' }),
    ]);
    expect(ctx.persistTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'token-new',
        refresh_token: 'refresh-new',
      }),
    );
  });

  it('paginates monday.com boards while listing syncable resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('boards(limit: $limit')) {
          if (body.variables?.page === 1) {
            return Promise.resolve(
              jsonResponse({
                data: {
                  boards: Array.from({ length: 100 }, (_, index) => ({
                    id: `board-${String(index + 1)}`,
                    name: `Board ${String(index + 1)}`,
                    workspace: null,
                  })),
                },
              }),
            );
          }
          expect(body.variables?.page).toBe(2);
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [{ id: 'board-101', name: 'Board 101', workspace: null }],
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: { docs: [] } }));
      }),
    );

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toHaveLength(101);
    expect(resources.at(-1)).toMatchObject({
      externalId: 'board-101',
      label: 'Board 101',
      kind: 'monday.board',
    });
  });

  it('lists monday.com boards without workspace labels when workspace metadata is unauthorized', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('workspace { id name }')) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message:
                  "Unauthorized to load field 'Query.boards.workspace', Reason: missing required scopes.",
              },
            ],
          }),
        );
      }
      if (body.query.includes('boards(limit: $limit')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [{ id: 'board-1', name: 'Launch' }],
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse({ data: { docs: [] } }));
    });
    vi.stubGlobal('fetch', fetch);

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toEqual([
      expect.objectContaining({ externalId: 'board-1', label: 'Launch', kind: 'monday.board' }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reuses the workspace-free monday.com boards query after workspace metadata is unauthorized', async () => {
    let workspaceBoardQueries = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('docs(')) {
          return Promise.resolve(jsonResponse({ data: { docs: [] } }));
        }
        if (body.query.includes('workspace { id name }')) {
          workspaceBoardQueries += 1;
          return Promise.resolve(
            jsonResponse({ errors: [{ message: 'Unauthorized field or type' }] }),
          );
        }
        if (body.query.includes('boards(limit: $limit')) {
          if (body.variables?.page === 1) {
            return Promise.resolve(
              jsonResponse({
                data: {
                  boards: Array.from({ length: 100 }, (_, index) => ({
                    id: `board-${String(index + 1)}`,
                    name: `Board ${String(index + 1)}`,
                  })),
                },
              }),
            );
          }
          expect(body.variables?.page).toBe(2);
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [{ id: 'board-101', name: 'Board 101' }],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toHaveLength(101);
    expect(resources.at(-1)).toMatchObject({
      externalId: 'board-101',
      label: 'Board 101',
      kind: 'monday.board',
    });
    expect(workspaceBoardQueries).toBe(1);
  });

  it('refreshes expired monday.com tokens and persists the replacement before syncing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (requestUrl(input) === 'https://auth.monday.com/oauth2/token') {
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
      expect(init?.headers).toMatchObject({ authorization: 'token-new' });
      const body = requestPayload(init);
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  updated_at: '2026-06-20T09:00:00Z',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
      }
      if (body.query.includes('items_page')) {
        return Promise.resolve(
          jsonResponse({ data: { boards: [{ items_page: { cursor: null, items: [] } }] } }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn().mockResolvedValue(undefined),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: {
        access_token: 'token-old',
        refresh_token: 'refresh-old',
        expires_at: Date.now() - 1_000,
      },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    expect(ctx.persistTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'token-new',
        refresh_token: 'refresh-new',
      }),
    );
  });

  it('syncs monday.com boards when workspace metadata is unauthorized', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('workspace { id name }')) {
        return Promise.resolve(
          jsonResponse({
            errors: [
              {
                message:
                  "Unauthorized to load field 'Query.boards.workspace', Reason: missing required scopes.",
              },
            ],
          }),
        );
      }
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  updated_at: '2026-06-20T09:00:00Z',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
      }
      if (body.query.includes('items_page')) {
        return Promise.resolve(
          jsonResponse({ data: { boards: [{ items_page: { cursor: null, items: [] } }] } }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn().mockResolvedValue(undefined),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    expect(ctx.writeEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        dedupKey: 'monday:board-schema:board-1:2026-06-20T09:00:00.000Z',
      }),
    ]);
  });

  it('normalizes and renders parent groups and people columns beyond the generic column budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (
          body.query.includes('boards(ids: $ids)') &&
          !body.query.includes('items_page') &&
          !body.query.includes('activity_logs')
        ) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'Product',
                    updated_at: '2026-06-20T09:00:00Z',
                    columns: [
                      ...Array.from({ length: 12 }, (_, index) => ({
                        id: `detail_${String(index + 1)}`,
                        title: `Detail ${String(index + 1)}`,
                        type: 'text',
                      })),
                      { id: 'status', title: 'Stage', type: 'status' },
                      { id: 'owner', title: 'Owner', type: 'people' },
                      { id: 'due_date', title: 'Due date', type: 'date' },
                      { id: 'priority', title: 'Priority', type: 'priority' },
                      { id: 'untrusted_payload', title: 'Untrusted payload', type: 'text' },
                    ],
                  },
                ],
              },
            }),
          );
        }
        if (body.query.includes('activity_logs')) {
          return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
        }
        if (body.query.includes('items_page')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    items_page: {
                      cursor: null,
                      items: [
                        {
                          id: 'item-1',
                          name: 'Publish launch plan',
                          updated_at: '2026-06-20T10:00:00Z',
                          group: { id: 'group-active', title: 'Active work' },
                          column_values: [
                            ...Array.from({ length: 12 }, (_, index) => ({
                              id: `detail_${String(index + 1)}`,
                              type: 'text',
                              text: `detail ${String(index + 1)}`,
                            })),
                            { id: 'status', type: 'status', text: 'Working on it' },
                            {
                              id: 'owner',
                              type: 'people',
                              text: 'Ada Lovelace, Research, Product team',
                              persons_and_teams: [
                                { id: 'person-1', kind: 'person' },
                                { id: 'team-1', kind: 'team' },
                              ],
                              value:
                                '{"personsAndTeams":[{"id":"person-1","kind":"person"},{"id":"team-1","kind":"team"}]}',
                            },
                            { id: 'due_date', type: 'date', text: '2026-06-30' },
                            { id: 'priority', type: 'priority', text: 'High' },
                            {
                              id: 'untrusted_payload',
                              type: 'text',
                              text: null,
                              value:
                                '{"personsAndTeams":[{"id":"not-an-assignee","kind":"person"}]}',
                            },
                          ],
                          updates: [],
                          subitems: [],
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    const event = ((ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[]).find(
      (candidate) => candidate.externalObjectId === 'item-1',
    );
    expect(event?.contentText).toContain('Group: Active work');
    expect(event?.contentText).toContain('Status: Working on it');
    expect(event?.contentText).toContain('Owner: Ada Lovelace, Research, Product team');
    expect(event?.contentText).toContain('Due date: 2026-06-30');
    expect(event?.contentText).toContain('Priority: High');
    expect(event?.extra).toMatchObject({
      monday_group: { id: 'group-active', title: 'Active work' },
      monday_assignees: [
        {
          columnId: 'owner',
          columnTitle: 'Owner',
          id: 'person-1',
          kind: 'person',
          name: null,
        },
        {
          columnId: 'owner',
          columnTitle: 'Owner',
          id: 'team-1',
          kind: 'team',
          name: null,
        },
      ],
    });
    expect(event?.objectMap?.metadata).toMatchObject({
      monday_group: { id: 'group-active', title: 'Active work' },
      monday_assignees: [
        {
          columnId: 'owner',
          columnTitle: 'Owner',
          id: 'person-1',
          kind: 'person',
          name: null,
        },
        {
          columnId: 'owner',
          columnTitle: 'Owner',
          id: 'team-1',
          kind: 'team',
          name: null,
        },
      ],
    });
    const columns = event?.objectMap?.metadata?.monday_columns as
      | Record<string, unknown>[]
      | undefined;
    expect(columns?.find((column) => column.id === 'owner')).toMatchObject({
      assignees: [
        { id: 'person-1', kind: 'person', name: null },
        { id: 'team-1', kind: 'team', name: null },
      ],
    });
    expect(columns?.find((column) => column.id === 'untrusted_payload')).toEqual({
      id: 'untrusted_payload',
      title: 'Untrusted payload',
      type: 'text',
      text: null,
      value: '{"personsAndTeams":[{"id":"not-an-assignee","kind":"person"}]}',
    });
  });

  it('normalizes legacy person and team base values without pairing comma-separated display text to IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        expect(body.variables).toEqual({ itemIds: ['subitem-1'] });
        return Promise.resolve(
          jsonResponse({
            data: {
              items: [
                {
                  id: 'subitem-1',
                  name: 'Review launch copy',
                  updated_at: '2026-06-20T10:00:00Z',
                  group: { id: 'group-review', title: 'Editorial review' },
                  board: {
                    id: 'subitems-board-1',
                    name: 'Subitems of Product',
                    type: 'sub_items_board',
                    hierarchy_type: 'classic',
                    columns: [
                      { id: 'assignee', title: 'Assignee', type: 'people' },
                      { id: 'legacy_person', title: 'Legacy person', type: 'person' },
                      { id: 'legacy_team', title: 'Legacy team', type: 'team' },
                      { id: 'legacy_invalid', title: 'Legacy invalid', type: 'person' },
                    ],
                  },
                  parent_item: {
                    id: 'item-1',
                    name: 'Publish launch plan',
                    board: {
                      id: 'board-1',
                      name: 'Product',
                      type: 'board',
                      hierarchy_type: 'classic',
                    },
                  },
                  column_values: [
                    {
                      id: 'assignee',
                      type: 'people',
                      text: 'Grace Hopper',
                      value: '{"personsAndTeams":[{"id":42,"kind":"person"}]}',
                    },
                    {
                      id: 'legacy_person',
                      type: 'person',
                      text: 'Doe, Jane, Alice Nguyen',
                      value:
                        '{"personsAndTeams":[{"id":101,"kind":"person"},{"id":102,"kind":"person"}]}',
                    },
                    {
                      id: 'legacy_team',
                      type: 'team',
                      text: 'Research, Design',
                      value: '{"persons_and_teams":[{"id":"team-7","kind":"team"}]}',
                    },
                    {
                      id: 'legacy_invalid',
                      type: 'person',
                      text: 'Unresolved legacy person',
                      value: '{not valid JSON}',
                    },
                  ],
                  updates: [],
                  subitems: [],
                },
              ],
            },
          }),
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

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      target: {
        resourceType: 'monday.item',
        externalId: 'board-1:subitem-1',
        triggeredBy: 'webhook',
      },
      ctx,
    });

    const event = ((ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[])[0];
    expect(event).toMatchObject({
      eventType: 'subitem.updated',
      extra: {
        monday_group: { id: 'group-review', title: 'Editorial review' },
        monday_assignees: [
          {
            columnId: 'assignee',
            columnTitle: 'Assignee',
            id: '42',
            kind: 'person',
            name: null,
          },
          {
            columnId: 'legacy_person',
            columnTitle: 'Legacy person',
            id: '101',
            kind: 'person',
            name: null,
          },
          {
            columnId: 'legacy_person',
            columnTitle: 'Legacy person',
            id: '102',
            kind: 'person',
            name: null,
          },
          {
            columnId: 'legacy_team',
            columnTitle: 'Legacy team',
            id: 'team-7',
            kind: 'team',
            name: null,
          },
        ],
      },
      objectMap: {
        metadata: {
          monday_group: { id: 'group-review', title: 'Editorial review' },
          monday_assignees: [
            {
              columnId: 'assignee',
              columnTitle: 'Assignee',
              id: '42',
              kind: 'person',
              name: null,
            },
            {
              columnId: 'legacy_person',
              columnTitle: 'Legacy person',
              id: '101',
              kind: 'person',
              name: null,
            },
            {
              columnId: 'legacy_person',
              columnTitle: 'Legacy person',
              id: '102',
              kind: 'person',
              name: null,
            },
            {
              columnId: 'legacy_team',
              columnTitle: 'Legacy team',
              id: 'team-7',
              kind: 'team',
              name: null,
            },
          ],
        },
      },
    });
    expect(event?.contentText).toContain('Group: Editorial review');
    expect(event?.contentText).toContain('Assignee: Grace Hopper');
    expect(event?.contentText).toContain('Legacy person: Doe, Jane, Alice Nguyen');
    expect(event?.contentText).toContain('Legacy team: Research, Design');
    expect(event?.contentText).toContain('Legacy invalid: Unresolved legacy person');
  });

  it('syncs board activity, records, subitems, paginated items, and updates into timeline events', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  updated_at: '2026-06-20T09:00:00Z',
                  workspace: { id: 'workspace-1', name: 'Sales' },
                  columns: [
                    { id: 'status', title: 'Stage', type: 'status' },
                    { id: 'deal_value', title: 'Deal value', type: 'numbers' },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  activity_logs: [
                    {
                      id: 'activity-1',
                      event: 'change_status_column_value',
                      created_at: '2026-06-20T10:00:00Z',
                      user_id: 'user-1',
                      data: JSON.stringify({
                        pulse_id: 'item-1',
                        pulse_name: 'Acme renewal',
                        column_title: 'Stage',
                        value: 'Won',
                      }),
                    },
                  ],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('next_items_page')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              next_items_page: {
                cursor: null,
                items: [
                  {
                    id: 'item-2',
                    name: 'Globex expansion',
                    updated_at: '2026-06-20T11:30:00Z',
                    column_values: [{ id: 'status', type: 'status', text: 'Working on it' }],
                    updates: [],
                    subitems: [],
                  },
                ],
              },
            },
          }),
        );
      }
      if (body.query.includes('items_page')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  items_page: {
                    cursor: 'cursor-2',
                    items: [
                      {
                        id: 'item-1',
                        name: 'Acme renewal',
                        updated_at: '2026-06-20T11:00:00Z',
                        url: 'https://monday.com/boards/1/pulses/1',
                        creator: { id: 'user-1', name: 'Ada' },
                        column_values: [
                          { id: 'status', type: 'status', text: 'Won' },
                          { id: 'deal_value', type: 'numbers', text: '$42,000', value: '42000' },
                        ],
                        updates: [
                          {
                            id: 'update-1',
                            body: 'Legal approved the renewal',
                            created_at: '2026-06-20T12:00:00Z',
                            creator: { id: 'user-1', name: 'Ada' },
                          },
                        ],
                        subitems: [
                          {
                            id: 'subitem-1',
                            name: 'Security review',
                            updated_at: '2026-06-20T12:30:00Z',
                            parent_item: { id: 'item-1', name: 'Acme renewal' },
                            column_values: [{ id: 'status', type: 'status', text: 'Done' }],
                            updates: [
                              {
                                id: 'update-2',
                                body: 'Security signed off',
                                created_at: '2026-06-20T13:00:00Z',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    expect(ctx.writeEvents).toHaveBeenCalledTimes(1);
    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual([
      'board.schema',
      'status.changed',
      'item.updated',
      'update.created',
      'subitem.updated',
      'update.created',
      'item.updated',
    ]);
    expect(events[1]?.contentText).toContain('Monday status changed on Pipeline: Acme renewal');
    expect(events[2]?.objectMap).toMatchObject({
      type: 'other',
      displayTitle: 'Acme renewal',
      status: 'done',
      metadata: {
        monday_record_kind: 'item',
        monday_board_id: 'board-1',
      },
    });
    const columns = events[2]?.objectMap?.metadata?.monday_columns;
    expect(columns).toEqual([
      { id: 'status', title: 'Stage', type: 'status', text: 'Won', value: null },
      {
        id: 'deal_value',
        title: 'Deal value',
        type: 'numbers',
        text: '$42,000',
        value: '42000',
      },
    ]);
    expect(events[3]?.contentText).toContain('Legal approved the renewal');
    expect(events[4]?.objectMap).toMatchObject({
      type: 'other',
      displayTitle: 'Security review',
      metadata: {
        monday_record_kind: 'subitem',
        monday_parent_item_id: 'item-1',
      },
    });
    expect(events[5]?.contentText).toContain('Security signed off');
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.board:board-1',
      expect.objectContaining({
        activity_since: '2026-06-20T10:00:00.000Z',
        item_since: '2026-06-20T13:00:00.000Z',
      }),
    );
    expect(ctx.recordAudit).toHaveBeenCalledWith('monday_board_synced', {
      boardId: 'board-1',
      hierarchyType: 'classic',
      parentItemCount: 2,
      subitemCount: 1,
      updateCount: 2,
      activityCount: 1,
      eventCount: 7,
      hasMoreItems: false,
      cursorRestarted: false,
    });
  });

  it('syncs every level of a multi-level board under one selected board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (
          body.query.includes('boards(ids: $ids)') &&
          !body.query.includes('items_page') &&
          !body.query.includes('activity_logs')
        ) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'Portfolio projects',
                    type: 'board',
                    board_kind: 'public',
                    hierarchy_type: 'multi_level',
                    updated_at: '2026-06-20T09:00:00Z',
                    columns: [{ id: 'status', title: 'Stage', type: 'status' }],
                  },
                ],
              },
            }),
          );
        }
        if (body.query.includes('activity_logs')) {
          return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
        }
        if (body.query.includes('items_page')) {
          expect(body.query).toContain('hierarchy_scope_config: "allItems"');
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    items_page: {
                      cursor: null,
                      items: [
                        {
                          id: 'item-1',
                          name: 'Launch',
                          updated_at: '2026-06-20T10:00:00Z',
                          column_values: [],
                          updates: [],
                          subitems: [],
                        },
                        {
                          id: 'item-2',
                          name: 'Recruit partners',
                          updated_at: '2026-06-20T10:01:00Z',
                          parent_item: { id: 'item-1', name: 'Launch' },
                          column_values: [],
                          updates: [],
                          subitems: [],
                        },
                        {
                          id: 'item-3',
                          name: 'Research',
                          updated_at: '2026-06-20T10:02:00Z',
                          parent_item: { id: 'item-2', name: 'Recruit partners' },
                          column_values: [],
                          updates: [],
                          subitems: [],
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual([
      'board.schema',
      'item.updated',
      'subitem.updated',
      'subitem.updated',
    ]);
    expect(events.slice(1).map((event) => event.externalObjectId)).toEqual([
      'item-1',
      'item-2',
      'item-3',
    ]);
    expect(events[3]?.objectMap?.metadata).toMatchObject({
      monday_board_id: 'board-1',
      monday_parent_board_id: 'board-1',
      monday_item_board_id: 'board-1',
      monday_parent_item_id: 'item-2',
      monday_hierarchy_depth: 2,
    });
  });

  it('continues a backfill when one selected board fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        const boardId = String((body.variables?.ids as string[] | undefined)?.[0]);
        if (
          body.query.includes('boards(ids: $ids)') &&
          !body.query.includes('items_page') &&
          !body.query.includes('activity_logs')
        ) {
          if (boardId === 'board-1') {
            return Promise.resolve(
              jsonResponse({ errors: [{ message: 'Board access was revoked' }] }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-2',
                    name: 'Healthy board',
                    hierarchy_type: 'classic',
                    updated_at: '2026-06-20T09:00:00Z',
                    columns: [],
                  },
                ],
              },
            }),
          );
        }
        if (body.query.includes('activity_logs')) {
          return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
        }
        if (body.query.includes('items_page')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    items_page: {
                      cursor: null,
                      items: [
                        {
                          id: 'item-2',
                          name: 'Visible item',
                          updated_at: '2026-06-20T10:00:00Z',
                          column_values: [],
                          updates: [],
                          subitems: [],
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    const result = await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [
        { kind: 'monday.board', externalId: 'board-1' },
        { kind: 'monday.board', externalId: 'board-2' },
      ],
      ctx,
    });

    expect(result?.partialFailures).toEqual([
      {
        resource: 'monday.board:board-1',
        surface: 'board',
        error: 'Monday GraphQL errors: Board access was revoked',
      },
    ]);
    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toContain('item-2');
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.board:board-2',
      expect.objectContaining({ item_since: '2026-06-20T10:00:00.000Z' }),
    );
  });

  it('hydrates a single monday.com item for targeted webhook syncs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('items(ids: $itemIds)')) {
        expect(body.variables).toEqual({ itemIds: ['item-1'] });
        return Promise.resolve(
          jsonResponse({
            data: {
              items: [
                {
                  id: 'item-1',
                  name: 'Acme renewal',
                  updated_at: '2026-06-20T10:00:00Z',
                  url: 'https://monday.com/items/item-1',
                  board: {
                    id: 'board-1',
                    name: 'Pipeline',
                    updated_at: '2026-06-20T09:00:00Z',
                    workspace: { id: 'workspace-1', name: 'Sales' },
                    columns: [
                      { id: 'status', title: 'Stage', type: 'status' },
                      { id: 'deal_value', title: 'Deal value', type: 'numbers' },
                    ],
                  },
                  creator: { id: 'user-1', name: 'Ada' },
                  column_values: [
                    { id: 'status', text: 'Won', type: 'status', value: null },
                    { id: 'deal_value', text: '$42,000', type: 'numbers', value: '42000' },
                  ],
                  updates: [
                    {
                      id: 'update-1',
                      body: 'Legal approved the renewal',
                      created_at: '2026-06-20T10:05:00Z',
                      updated_at: '2026-06-20T10:05:00Z',
                      creator: { id: 'user-2', name: 'Grace' },
                    },
                  ],
                  subitems: [],
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      target: {
        resourceType: 'monday.item',
        externalId: 'board-1:item-1',
        triggeredBy: 'webhook',
        reason: 'monday_item_webhook',
      },
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual(['item.updated', 'update.created']);
    expect(events[0]?.objectMap).toMatchObject({
      displayTitle: 'Acme renewal',
      status: 'done',
      metadata: {
        monday_board_id: 'board-1',
      },
    });
    expect(ctx.saveCursor).toHaveBeenCalledWith('monday.item:board-1:item-1', {
      item_since: '2026-06-20T10:05:00.000Z',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('hydrates a classic subitem against its selected parent board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        expect(body.variables).toEqual({ itemIds: ['subitem-1'] });
        return Promise.resolve(
          jsonResponse({
            data: {
              items: [
                {
                  id: 'subitem-1',
                  name: 'Security review',
                  updated_at: '2026-06-20T10:00:00Z',
                  board: {
                    id: 'subitems-board-1',
                    name: 'Subitems of Pipeline',
                    type: 'sub_items_board',
                    hierarchy_type: 'classic',
                    columns: [{ id: 'status', title: 'Subitem stage', type: 'status' }],
                  },
                  parent_item: {
                    id: 'item-1',
                    name: 'Acme renewal',
                    board: {
                      id: 'board-1',
                      name: 'Pipeline',
                      type: 'board',
                      hierarchy_type: 'classic',
                      columns: [{ id: 'status', title: 'Stage', type: 'status' }],
                    },
                  },
                  column_values: [{ id: 'status', text: 'Done', type: 'status', value: null }],
                  updates: [],
                  subitems: [],
                },
              ],
            },
          }),
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

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      target: {
        resourceType: 'monday.item',
        externalId: 'board-1:subitem-1',
        triggeredBy: 'webhook',
      },
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'subitem.updated',
      extra: {
        monday_board_id: 'board-1',
        monday_item_board_id: 'subitems-board-1',
        monday_parent_item_id: 'item-1',
      },
      objectMap: {
        status: 'done',
        metadata: {
          monday_board_id: 'board-1',
          monday_item_board_id: 'subitems-board-1',
          monday_parent_item_id: 'item-1',
          monday_columns: [
            {
              id: 'status',
              title: 'Subitem stage',
              type: 'status',
              text: 'Done',
              value: null,
            },
          ],
        },
      },
    });
    expect(ctx.recordAudit).not.toHaveBeenCalledWith(
      'targeted_item_board_mismatch',
      expect.anything(),
    );
  });

  it('uses the item cursor to filter monday.com records during incremental sync', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  updated_at: '2026-06-20T09:00:00Z',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
      }
      if (body.query.includes('items_page')) {
        expect(body.query).toContain('$updatedSinceCompareValue: CompareValue!');
        expect(body.query).toContain('compare_value: $updatedSinceCompareValue');
        expect(body.query).not.toContain('$updatedSinceDay: String!');
        expect(body.query).toContain('column_id: "__last_updated__"');
        expect(body.query).toContain('compare_attribute: "UPDATED_AT"');
        expect(body.query).toContain('operator: greater_than_or_equals');
        expect(body.variables).toMatchObject({
          updatedSinceCompareValue: ['EXACT', '2026-06-19'],
        });
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  items_page: {
                    cursor: null,
                    items: [
                      {
                        id: 'item-1',
                        name: 'Updated account',
                        updated_at: '2026-06-20T11:00:00Z',
                        column_values: [],
                        updates: [],
                        subitems: [],
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        activity_since: '2026-06-19T10:00:00.000Z',
        item_since: '2026-06-19T10:00:00.000Z',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.externalObjectId)).toContain('item-1');
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.board:board-1',
      expect.objectContaining({ item_since: '2026-06-20T11:00:00.000Z' }),
    );
  });

  it('resumes a monday.com backfill when a board exceeds one sync batch', async () => {
    const itemForPage = (page: number) => ({
      id: `item-${String(page)}`,
      name: `Record ${String(page)}`,
      updated_at: `2026-06-20T${String(Math.floor(page / 60)).padStart(2, '0')}:${String(
        page % 60,
      ).padStart(2, '0')}:00Z`,
      column_values: [],
      updates: [],
      subitems: [],
    });
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  updated_at: '2026-06-20T00:00:00Z',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
      }
      if (body.query.includes('next_items_page')) {
        const cursor = String(body.variables?.cursor);
        const page = Number(cursor.replace('cursor-', ''));
        return Promise.resolve(
          jsonResponse({
            data: {
              next_items_page: {
                cursor: page < 101 ? `cursor-${String(page + 1)}` : null,
                items: [itemForPage(page)],
              },
            },
          }),
        );
      }
      if (body.query.includes('items_page')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  items_page: {
                    cursor: 'cursor-2',
                    items: [itemForPage(1)],
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({
        activity_since: '2026-06-20T00:00:00.000Z',
        item_page_cursor: 'cursor-101',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    const firstResult = await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });
    const secondResult = await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    expect(firstResult?.continuations).toEqual([
      { resourceType: 'monday.board', externalId: 'board-1' },
    ]);
    expect(secondResult?.continuations).toBeUndefined();

    expect(ctx.saveCursor).toHaveBeenNthCalledWith(
      1,
      'monday.board:board-1',
      expect.objectContaining({ item_page_cursor: 'cursor-101' }),
    );
    expect(ctx.saveCursor).toHaveBeenNthCalledWith(
      2,
      'monday.board:board-1',
      expect.objectContaining({
        item_since: '2026-06-20T01:41:00.000Z',
      }),
    );
    expect(ctx.saveCursor.mock.calls[1]?.[1]).not.toHaveProperty('item_page_cursor');
    expect(
      (ctx.writeEvents.mock.calls[0]?.[0] as IntegrationEvent[]).map(
        (event) => event.externalObjectId,
      ),
    ).toContain('item-100');
    expect(
      (ctx.writeEvents.mock.calls[1]?.[0] as IntegrationEvent[]).map(
        (event) => event.externalObjectId,
      ),
    ).toContain('item-101');
  });

  it('restarts an incremental page scan when the saved monday cursor expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (
        body.query.includes('boards(ids: $ids)') &&
        !body.query.includes('items_page') &&
        !body.query.includes('activity_logs')
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  id: 'board-1',
                  name: 'Pipeline',
                  hierarchy_type: 'classic',
                  updated_at: '2026-06-20T00:00:00Z',
                  columns: [],
                },
              ],
            },
          }),
        );
      }
      if (body.query.includes('activity_logs')) {
        return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
      }
      if (body.query.includes('next_items_page')) {
        throw new Error('expired provider cursor must not be reused');
      }
      if (body.query.includes('items_page')) {
        expect(body.variables).toMatchObject({
          updatedSinceCompareValue: ['EXACT', '2026-06-19'],
        });
        return Promise.resolve(
          jsonResponse({
            data: {
              boards: [
                {
                  items_page: {
                    cursor: null,
                    items: [
                      {
                        id: 'item-1',
                        name: 'Recovered item',
                        updated_at: '2026-06-20T11:00:00Z',
                        column_values: [],
                        updates: [],
                        subitems: [],
                      },
                    ],
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        activity_since: '2026-06-19T10:00:00.000Z',
        item_since: '2026-06-19T10:00:00.000Z',
        item_page_cursor: 'expired-cursor',
        item_page_cursor_expires_at: '2026-06-20T11:00:00.000Z',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    const saved = ctx.saveCursor.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('item_page_cursor');
    expect(saved).not.toHaveProperty('item_page_cursor_expires_at');
    expect(saved).toMatchObject({ item_since: '2026-06-20T11:00:00.000Z' });
  });

  it('does not advance the monday.com item cursor from board schema timestamps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (
          body.query.includes('boards(ids: $ids)') &&
          !body.query.includes('items_page') &&
          !body.query.includes('activity_logs')
        ) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'Pipeline',
                    updated_at: '2026-06-22T12:00:00Z',
                    columns: [],
                  },
                ],
              },
            }),
          );
        }
        if (body.query.includes('activity_logs')) {
          return Promise.resolve(jsonResponse({ data: { boards: [{ activity_logs: [] }] } }));
        }
        if (body.query.includes('items_page')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    items_page: {
                      cursor: null,
                      items: [
                        {
                          id: 'item-1',
                          name: 'Older record',
                          updated_at: '2026-06-20T11:00:00Z',
                          column_values: [],
                          updates: [],
                          subitems: [],
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.board:board-1',
      expect.objectContaining({ item_since: '2026-06-20T11:00:00.000Z' }),
    );
  });

  it('syncs selected WorkDocs as timeline events and harvested documents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('blocks(limit: $blockLimit')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                docs: [
                  {
                    id: 'doc-1',
                    object_id: 'object-1',
                    name: 'Launch notes',
                    created_at: '2026-06-18T09:00:00Z',
                    updated_at: '2026-06-20T14:00:00Z',
                    url: 'https://monday.com/docs/doc-1',
                    workspace_id: 'workspace-1',
                    workspace: { id: 'workspace-1', name: 'Product' },
                    created_by: { id: 'user-1', name: 'Ada' },
                    blocks: [
                      { id: 'block-1', type: 'normal_text', content: 'Launch moved to Friday.' },
                    ],
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      harvestDocument: vi.fn().mockResolvedValue({ documentId: 'doc-id', versionId: 'version-id' }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.doc', externalId: 'doc-1' }],
      ctx,
    });

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'monday',
      externalObjectId: 'doc-1',
      eventType: 'doc.updated',
      objectMap: {
        type: 'document',
        displayTitle: 'Launch notes',
        externalId: 'doc:doc-1',
      },
    });
    expect(events[0]?.contentText).toContain('Launch moved to Friday.');
    expect(ctx.harvestDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Launch notes.md',
        contentType: 'text/markdown',
        externalId: 'monday.doc:doc-1',
      }),
    );
    const harvested = ctx.harvestDocument.mock.calls[0]?.[0] as { body: Buffer };
    expect(harvested.body.toString('utf8')).toContain('# Launch notes');
    expect(harvested.body.toString('utf8')).toContain('Launch moved to Friday.');
    const savedCursor = ctx.saveCursor.mock.calls[0]?.[1] as
      | { doc_since?: string; doc_last_polled_at?: unknown }
      | undefined;
    expect(ctx.saveCursor).toHaveBeenCalledWith('monday.doc:doc-1', savedCursor);
    expect(savedCursor).toMatchObject({ doc_since: '2026-06-20T14:00:00.000Z' });
    expect(typeof savedCursor?.doc_last_polled_at).toBe('string');
  });

  it('skips selected WorkDocs during hourly incremental sync until their doc cursor is due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T14:00:00.000Z'));
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      throw new Error('WorkDoc should not be fetched before its reconciliation interval');
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        doc_since: '2026-06-20T14:00:00.000Z',
        doc_last_polled_at: '2026-06-21T13:00:00.000Z',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      harvestDocument: vi.fn().mockResolvedValue({ documentId: 'doc-id', versionId: 'version-id' }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.doc', externalId: 'doc-1' }],
      ctx,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.writeEvents).not.toHaveBeenCalled();
    expect(ctx.harvestDocument).not.toHaveBeenCalled();
    expect(ctx.saveCursor).not.toHaveBeenCalled();
  });

  it('reconciles selected WorkDocs after their daily doc cursor interval elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T14:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('blocks(limit: $blockLimit')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                docs: [
                  {
                    id: 'doc-1',
                    object_id: 'object-1',
                    name: 'Launch notes',
                    created_at: '2026-06-18T09:00:00Z',
                    updated_at: '2026-06-21T13:55:00Z',
                    url: 'https://monday.com/docs/doc-1',
                    workspace_id: 'workspace-1',
                    workspace: { id: 'workspace-1', name: 'Product' },
                    created_by: { id: 'user-1', name: 'Ada' },
                    blocks: [{ id: 'block-1', type: 'normal_text', content: 'Daily update.' }],
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        doc_since: '2026-06-20T14:00:00.000Z',
        doc_last_polled_at: '2026-06-20T13:59:59.000Z',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      harvestDocument: vi.fn().mockResolvedValue({ documentId: 'doc-id', versionId: 'version-id' }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.doc', externalId: 'doc-1' }],
      ctx,
    });

    expect(ctx.writeEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        externalObjectId: 'doc-1',
        eventType: 'doc.updated',
      }),
    ]);
    expect(ctx.harvestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'monday.doc:doc-1' }),
    );
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.doc:doc-1',
      expect.objectContaining({
        doc_since: '2026-06-21T13:55:00.000Z',
        doc_last_polled_at: '2026-06-21T14:00:00.000Z',
      }),
    );
  });

  it('continues WorkDoc block pagination until the current page is short', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('blocks(limit: $blockLimit')) {
          const page = Number(body.variables?.blockPage ?? 1);
          const blocks =
            page < 3
              ? Array.from({ length: 100 }, (_, index) => ({
                  id: `block-${String(page)}-${String(index)}`,
                  type: 'normal_text',
                  content: `Page ${String(page)} block ${String(index)}`,
                }))
              : [{ id: 'block-3-tail', type: 'normal_text', content: 'Third page tail.' }];
          return Promise.resolve(
            jsonResponse({
              data: {
                docs: [
                  {
                    id: 'doc-1',
                    object_id: 'object-1',
                    name: 'Long WorkDoc',
                    created_at: '2026-06-18T09:00:00Z',
                    updated_at: '2026-06-20T14:00:00Z',
                    url: 'https://monday.com/docs/doc-1',
                    workspace_id: 'workspace-1',
                    workspace: { id: 'workspace-1', name: 'Product' },
                    created_by: { id: 'user-1', name: 'Ada' },
                    blocks,
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      harvestDocument: vi.fn().mockResolvedValue({ documentId: 'doc-id', versionId: 'version-id' }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.doc', externalId: 'doc-1' }],
      ctx,
    });

    const harvested = ctx.harvestDocument.mock.calls[0]?.[0] as { body: Buffer };
    expect(harvested.body.toString('utf8')).toContain('Third page tail.');
  });

  it('skips WorkDoc harvest when the event and cursor already match', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('blocks(limit: $blockLimit')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                docs: [
                  {
                    id: 'doc-1',
                    name: 'Launch notes',
                    updated_at: '2026-06-20T14:00:00Z',
                    blocks: [{ id: 'block-1', content: 'No change.' }],
                  },
                ],
              },
            }),
          );
        }
        throw new Error(`unexpected query: ${body.query}`);
      }),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({ doc_since: '2026-06-20T14:00:00.000Z' }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      harvestDocument: vi.fn().mockResolvedValue({ documentId: 'doc-id', versionId: 'version-id' }),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.doc', externalId: 'doc-1' }],
      ctx,
    });

    expect(ctx.writeEvents).toHaveBeenCalledTimes(1);
    expect(ctx.harvestDocument).not.toHaveBeenCalled();
  });
});
