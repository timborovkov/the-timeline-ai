import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationEvent } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { mondayProvider } from '#src/integrations/providers/monday.js';

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
    expect(url.searchParams.get('scope')).toBe('boards:read users:read updates:read docs:read');
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

      const body = requestPayload(init);
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
      externalAccountId: 'user-1',
      displayName: 'Monday.com — Ada Lovelace',
      scopes: ['boards:read', 'users:read', 'updates:read', 'docs:read'],
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

  it('hides monday.com subitem boards from source sharing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('boards(limit: $limit')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                boards: [
                  {
                    id: 'board-1',
                    name: 'KIESI',
                    board_kind: 'public',
                    workspace: null,
                  },
                  {
                    id: 'subitems-board-1',
                    name: 'Subitems of KIESI',
                    workspace: null,
                  },
                  {
                    id: 'real-board-with-subitems-name',
                    name: 'Subitems of Marketing',
                    board_kind: 'public',
                    workspace: null,
                  },
                  {
                    id: 'localized-subitems-board-1',
                    name: 'Alitehtävät KIESI',
                    board_kind: 'sub_items_board',
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

    expect(resources).toHaveLength(2);
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
          jsonResponse({ errors: [{ message: 'Unauthorized field or type' }] }),
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
      if (body.query.includes('columns { id title type }')) {
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
          jsonResponse({ errors: [{ message: 'Unauthorized field or type' }] }),
        );
      }
      if (body.query.includes('columns { id title type }')) {
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

  it('syncs board activity, records, subitems, paginated items, and updates into timeline events', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('columns { id title type }')) {
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
  });

  it('uses the item cursor to filter monday.com records during incremental sync', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const body = requestPayload(init);
      if (body.query.includes('columns { id title type }')) {
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
        expect(body.query).toContain('column_id: "__last_updated__"');
        expect(body.query).toContain('compare_attribute: "UPDATED_AT"');
        expect(body.query).toContain('operator: greater_than_or_equals');
        expect(body.variables).toMatchObject({ updatedSinceDay: '2026-06-19' });
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

  it('persists the monday.com item page cursor when a board exceeds one sync batch', async () => {
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
      if (body.query.includes('columns { id title type }')) {
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

    await mondayProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });
    await mondayProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'monday.board', externalId: 'board-1' }],
      ctx,
    });

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

  it('does not advance the monday.com item cursor from board schema timestamps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>((_input, init) => {
        const body = requestPayload(init);
        if (body.query.includes('columns { id title type }')) {
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
    expect(ctx.saveCursor).toHaveBeenCalledWith('monday.doc:doc-1', {
      doc_since: '2026-06-20T14:00:00.000Z',
    });
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
