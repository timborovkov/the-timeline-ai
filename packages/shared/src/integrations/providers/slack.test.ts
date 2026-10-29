import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { IntegrationEvent } from '#src/integrations/types.js';
await vi.mock(
  import.meta.resolve('#src/http/external-fetch.js'),
  async () => ({
    ...(await import('#src/http/external-fetch.js')),
    externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
  }),
  () => import('#src/http/external-fetch.js'),
);

const { resetEnvForTests } = await import('#src/env.js');
const { slackProvider } = await import('#src/integrations/providers/slack.js');

const ENV_BACKUP = { ...process.env };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(
  input: Parameters<
    (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
  >[0],
): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('slackProvider', () => {
  beforeEach(() => {
    process.env.SLACK_CLIENT_ID = 'slack-client';
    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    process.env.SLACK_SIGNING_SECRET = 'slack-signing';
    resetEnvForTests();
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
    resetEnvForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates only the affected file for a channel-scoped file event', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, file: { id: 'F1', name: 'notes.pdf' } }));
    vi.stubGlobal('fetch', fetch);
    const events = await slackProvider.handleWebhook?.({
      integration: { externalAccountId: 'T1' } as never,
      tokens: { access_token: 'token' },
      payload: {
        event_id: 'E1',
        event: {
          type: 'file_shared',
          file_id: 'F1',
          channel_id: 'C1',
          event_ts: '1782000000.000100',
        },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://slack.com/api/files.info',
      expect.objectContaining({ body: 'file=F1' }),
    );
    expect(events).toEqual([
      expect.objectContaining({ externalObjectId: 'F1', eventType: 'file.shared' }),
    ]);
  });

  it('builds a Slack OAuth authorize URL for native ingestion scopes', async () => {
    const result = await slackProvider.startOAuth({
      teamId: 'team-1',
      userId: 'user-1',
      redirectUri: 'https://timeline.test/api/integrations/slack/callback',
      state: 'signed-state',
    });

    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('slack-client');
    expect(url.searchParams.get('scope')).toContain('channels:history');
    expect(url.searchParams.get('scope')).toContain('reactions:read');
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  it('lists public and private channels as syncable resources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          channels: [{ id: 'C123', name: 'leadership' }],
          response_metadata: {},
        }),
      ),
    );

    const resources = await slackProvider.listSyncableResources({} as never, {
      access_token: 'xoxb-token',
    });

    expect(resources).toEqual([
      { externalId: 'C123', label: '#leadership', kind: 'slack.channel' },
    ]);
  });

  it('syncs messages, thread replies, reactions, and files into integration events', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const method = input.split('/').at(-1);
      const params = new URLSearchParams(requestBody);
      if (method === 'conversations.history') {
        expect(params.get('channel')).toBe('C123');
        return Promise.resolve(
          jsonResponse({
            ok: true,
            messages: [
              {
                type: 'message',
                user: 'U123',
                username: 'Ada',
                text: 'Pricing decision',
                ts: '1782000000.000100',
                thread_ts: '1782000000.000100',
                reactions: [{ name: 'white_check_mark', count: 2, users: ['U123', 'U456'] }],
                files: [
                  {
                    id: 'F123',
                    name: 'pricing.pdf',
                    title: 'Pricing',
                    mimetype: 'application/pdf',
                    url_private: 'https://files.slack.test/F123',
                  },
                ],
              },
            ],
            response_metadata: {},
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          ok: true,
          messages: [{ type: 'message', user: 'U456', text: 'Agreed', ts: '1782000001.000200' }],
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

    await slackProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(events.map((event) => event.eventType)).toEqual([
      'message.created',
      'reaction.added',
      'file.shared',
      'message.created',
    ]);
    expect(events[1]?.dedupKey).toBe('slack:reaction:T123:C123:1782000000.000100:white_check_mark');
    expect(events[0]?.objectMap).toMatchObject({
      type: 'topic',
      externalId: 'C123:1782000000.000100',
    });
    expect(events[2]?.objectMap).toMatchObject({ type: 'document', externalId: 'F123' });
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'slack.channel:C123',
      expect.objectContaining({
        latest_ts: '1782000000.000100',
      }),
    );
  });

  it('uses the persisted integration account id as the Slack workspace id', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      if (input.endsWith('/conversations.history')) {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            messages: [
              {
                type: 'message',
                user: 'U123',
                text: 'Workspace id should come from the connection',
                ts: '1782000000.000100',
              },
            ],
            response_metadata: {},
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, messages: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await slackProvider.backfill({
      integration: { id: 'integration-1', externalAccountId: 'T_FROM_CONNECTION' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T_FROM_TOKEN', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(events[0]?.dedupKey).toBe('slack:message:T_FROM_CONNECTION:C123:1782000000.000100:');
    expect(events[0]?.extra).toMatchObject({ slack_team_id: 'T_FROM_CONNECTION' });
  });

  it('paginates Slack channel history until Slack returns no next cursor', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const params = new URLSearchParams(requestBody);
      if (!input.endsWith('/conversations.history')) {
        return Promise.resolve(jsonResponse({ ok: true, messages: [] }));
      }
      const cursor = params.get('cursor');
      const page = cursor ? Number(cursor.replace('page-', '')) : 0;
      return Promise.resolve(
        jsonResponse({
          ok: true,
          messages: [
            {
              type: 'message',
              user: 'U123',
              text: `Message ${String(page)}`,
              ts: `178200000${String(page)}.000100`,
            },
          ],
          response_metadata: page < 6 ? { next_cursor: `page-${String(page + 1)}` } : {},
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

    let saved: unknown = {};
    ctx.loadCursor.mockImplementation(() => Promise.resolve(saved));
    ctx.saveCursor.mockImplementation((_key: string, value: unknown) => {
      saved = structuredClone(value);
      return Promise.resolve();
    });
    for (let page = 0; page < 7; page++)
      await slackProvider.backfill({
        integration: { id: 'integration-1' } as never,
        tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
        selections: [{ kind: 'slack.channel', externalId: 'C123' }],
        ctx,
      });

    const historyCalls = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/conversations.history'),
    );
    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(historyCalls).toHaveLength(7);
    expect(events.map((event) => event.contentText)).toEqual([
      'Message 0',
      'Message 1',
      'Message 2',
      'Message 3',
      'Message 4',
      'Message 5',
      'Message 6',
    ]);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'slack.channel:C123',
      expect.objectContaining({
        latest_ts: '1782000006.000100',
      }),
    );
  });

  it('caps Slack history pages and stores a bounded backfill continuation marker', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const params = new URLSearchParams(requestBody);
      if (!input.endsWith('/conversations.history')) {
        return Promise.resolve(jsonResponse({ ok: true, messages: [] }));
      }
      const cursor = params.get('cursor');
      const page = cursor ? Number(cursor.replace('page-', '')) : 0;
      const ts = `${String(1782001000 - page)}.000100`;
      return Promise.resolve(
        jsonResponse({
          ok: true,
          messages: [{ type: 'message', user: 'U123', text: `Message ${String(page)}`, ts }],
          response_metadata: { next_cursor: `page-${String(page + 1)}` },
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

    await slackProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const historyCalls = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/conversations.history'),
    );
    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(historyCalls).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'slack.channel:C123',
      expect.objectContaining({
        latest_ts: '1782001000.000100',
        history_page: 'page-1',
      }),
    );
  });

  it('continues older Slack backfill from the stored continuation marker', async () => {
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const params = new URLSearchParams(requestBody);
      if (!input.endsWith('/conversations.history')) {
        return Promise.resolve(jsonResponse({ ok: true, messages: [] }));
      }
      if (params.get('latest') === '1782000976.000100') {
        return Promise.resolve(
          jsonResponse({
            ok: true,
            messages: [
              { type: 'message', user: 'U123', text: 'Older message', ts: '1782000975.000100' },
            ],
            response_metadata: {},
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, messages: [], response_metadata: {} }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({
        latest_ts: '1782001000.000100',
        backfill_before_ts: '1782000976.000100',
      }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await slackProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const historyParams = fetch.mock.calls
      .filter(([input]) => requestUrl(input).endsWith('/conversations.history'))
      .map(([, init]) => new URLSearchParams(init?.body as string));
    expect(historyParams.some((params) => params.get('latest') === '1782000976.000100')).toBe(true);
    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(events.map((event) => event.contentText)).toEqual(['Older message']);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'slack.channel:C123',
      expect.objectContaining({
        latest_ts: '1782001000.000100',
      }),
    );
  });

  it('uses a bounded 48-hour recovery window for recent edits and reactions', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1782000200 * 1000);
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const params = new URLSearchParams(requestBody);
      if (input.endsWith('/conversations.history')) {
        expect(Number(params.get('oldest'))).toBeLessThan(1782000100);
        expect(Number(params.get('oldest'))).toBe(1782000200 - 48 * 3600);
        return Promise.resolve(
          jsonResponse({
            ok: true,
            messages: [
              {
                type: 'message',
                user: 'U123',
                text: 'Edited older decision',
                ts: '1782000000.000100',
                edited: { user: 'U123', ts: '1782000090.000100' },
                reactions: [{ name: 'eyes', count: 1, users: ['U456'] }],
              },
            ],
            response_metadata: {},
          }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, messages: [] }));
    });
    vi.stubGlobal('fetch', fetch);
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({ latest_ts: '1782000100.000000' }),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await slackProvider.incrementalSync({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const events = ctx.writeEvents.mock.calls.flatMap((call) => call[0] as IntegrationEvent[]);
    expect(events.map((event) => event.eventType)).toEqual(['message.edited', 'reaction.added']);
    expect(ctx.saveCursor).toHaveBeenCalledWith(
      'slack.channel:C123',
      expect.objectContaining({
        latest_ts: '1782000100.000000',
      }),
    );
  });

  it('turns Slack Web API 429 responses into provider budget pauses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T01:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': '120', 'content-type': 'application/json' },
        }),
      ),
    );
    const ctx = {
      loadCursor: vi.fn().mockResolvedValue({}),
      saveCursor: vi.fn().mockResolvedValue(undefined),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };

    await expect(
      slackProvider.incrementalSync({
        integration: { id: 'integration-1', externalAccountId: 'T123' } as never,
        tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
        selections: [{ kind: 'slack.channel', externalId: 'C123' }],
        ctx,
      }),
    ).rejects.toMatchObject({
      provider: 'slack',
      scope: 'web_api',
      reason: 'slack_rate_limited',
      retryAfterSeconds: 120,
      retryAt: new Date('2026-06-28T01:02:00.000Z'),
    });
  });
  it.each([false, true])(
    'keeps resumed initial history unbounded, then bounds recovery (empty=%s)',
    async (empty) => {
      const fetch = vi
        .fn<(...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>>()
        .mockResolvedValueOnce(
          jsonResponse({
            ok: true,
            messages: empty ? [] : [{ ts: '100.000001', text: 'Old' }],
            response_metadata: { next_cursor: 'page-2' },
          }),
        )
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ ok: true, messages: [], response_metadata: {} })),
        );
      vi.stubGlobal('fetch', fetch);
      let saved: unknown = {};
      const ctx = {
        loadCursor: vi.fn(() => Promise.resolve(saved)),
        saveCursor: vi.fn((_key: string, value: unknown) => {
          saved = structuredClone(value);
          return Promise.resolve();
        }),
        writeEvents: vi.fn().mockResolvedValue([]),
        persistTokens: vi.fn(),
        recordAudit: vi.fn(),
      };
      const input = {
        integration: { externalAccountId: 'T1' } as never,
        tokens: { access_token: 'token' },
        selections: [{ kind: 'slack.channel', externalId: 'C1' }],
        ctx,
      };
      for (let run = 0; run < 3; run++) await slackProvider.incrementalSync(input);
      const params = fetch.mock.calls.map(([, init]) => new URLSearchParams(init?.body as string));
      expect(params[0]?.has('oldest')).toBe(false);
      expect(params[1]?.get('cursor')).toBe('page-2');
      expect(params[1]?.has('oldest')).toBe(false);
      expect(Number(params[2]?.get('oldest'))).toBeGreaterThan(Date.now() / 1000 - 49 * 3600);
    },
  );

  it('does not rehydrate unchanged threads during daily recovery', async () => {
    const now = Date.now();
    const ts = ((now - 3600_000) / 1000).toFixed(6);
    const root = {
      ts,
      thread_ts: ts,
      reply_count: 1,
      latest_reply: String(Number(ts) + 1),
      text: 'Root',
    };
    const fetch = vi.fn<
      (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
    >((url) =>
      Promise.resolve(
        jsonResponse({
          ok: true,
          messages: requestUrl(url).endsWith('/conversations.history')
            ? [root]
            : [{ ts: root.latest_reply, thread_ts: ts, text: 'Reply' }],
          response_metadata: {},
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    let cursor: unknown = { latest_ts: ts };
    const ctx = {
      loadCursor: vi.fn(() => Promise.resolve(cursor)),
      saveCursor: vi.fn((_key: string, value: unknown) => {
        cursor = structuredClone(value);
        return Promise.resolve();
      }),
      writeEvents: vi.fn().mockResolvedValue([]),
      persistTokens: vi.fn(),
      recordAudit: vi.fn(),
    };
    const input = {
      integration: { externalAccountId: 'T1' } as never,
      tokens: { access_token: 'token' },
      selections: [{ kind: 'slack.channel', externalId: 'C1' }],
      ctx,
    };
    await slackProvider.incrementalSync(input);
    await slackProvider.incrementalSync(input);
    expect(
      fetch.mock.calls.filter(([url]) => requestUrl(url).endsWith('/conversations.replies')),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) => requestUrl(url).endsWith('/conversations.history')),
    ).toHaveLength(2);
  });

  it('normalizes replies and deletions without any API hydration and deduplicates deliveries', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const handle = slackProvider.handleWebhook?.bind(slackProvider);
    if (!handle) throw new Error('missing Slack webhook handler');
    const input = {
      integration: { externalAccountId: 'T1' } as never,
      payload: {
        event_id: 'E1',
        event: {
          type: 'message',
          channel: 'C1',
          ts: '1782000001.000001',
          thread_ts: '1782000000.000001',
          text: 'Reply',
        },
      },
    };
    const first = await handle(input);
    expect(await handle(input)).toEqual(first);
    expect(first).toMatchObject([{ eventType: 'thread.reply' }]);
    expect(
      await handle({
        ...input,
        payload: {
          event_id: 'E2',
          event: {
            type: 'message',
            subtype: 'message_deleted',
            channel: 'C1',
            deleted_ts: '1782000001.000001',
            event_ts: '1782000002.000001',
          },
        },
      }),
    ).toMatchObject([{ eventType: 'message.deleted' }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
