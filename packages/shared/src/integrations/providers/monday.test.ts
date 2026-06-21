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
    expect(url.searchParams.get('scope')).toContain('boards:read');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('lists boards as syncable resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            boards: [
              { id: 'board-1', name: 'Launch', workspace: { id: 'workspace-1', name: 'Product' } },
            ],
          },
        }),
      ),
    );

    const resources = await mondayProvider.listSyncableResources({} as never, {
      access_token: 'token',
    });

    expect(resources).toEqual([
      { externalId: 'board-1', label: 'Product / Launch', kind: 'monday.board' },
    ]);
  });

  it('syncs board activity, items, and updates into integration events', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected JSON request body');
      const body = JSON.parse(requestBody) as { query: string };
      if (body.query.includes('boards(ids: $ids) { id name')) {
        return Promise.resolve(
          jsonResponse({
            data: { boards: [{ id: 'board-1', name: 'Launch', workspace: { name: 'Product' } }] },
          }),
        );
      }
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
                      pulse_name: 'Ship beta',
                      column_title: 'Status',
                      value: 'Done',
                    }),
                  },
                ],
                items_page: {
                  items: [
                    {
                      id: 'item-1',
                      name: 'Ship beta',
                      updated_at: '2026-06-20T11:00:00Z',
                      url: 'https://monday.com/boards/1/pulses/1',
                      column_values: [{ id: 'status', type: 'status', text: 'Done' }],
                      updates: [
                        {
                          id: 'update-1',
                          body: 'Ready to launch',
                          created_at: '2026-06-20T12:00:00Z',
                          creator: { id: 'user-1', name: 'Ada' },
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
      'status.changed',
      'item.updated',
      'update.created',
    ]);
    expect(events[0]?.objectMap).toMatchObject({ type: 'task', status: 'done' });
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'monday.board:board-1',
      expect.objectContaining({ activity_since: '2026-06-20T12:00:00.000Z' }),
    );
  });
});
