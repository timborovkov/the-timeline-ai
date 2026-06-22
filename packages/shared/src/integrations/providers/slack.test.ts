import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationEvent } from '#src/integrations/types.js';

import { resetEnvForTests } from '#src/env.js';
import { slackProvider } from '#src/integrations/providers/slack.js';

const ENV_BACKUP = { ...process.env };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
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
    vi.unstubAllGlobals();
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
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
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

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual([
      'message.created',
      'reaction.added',
      'file.shared',
      'message.created',
    ]);
    expect(events[0]?.objectMap).toMatchObject({
      type: 'topic',
      externalId: 'C123:1782000000.000100',
    });
    expect(events[2]?.objectMap).toMatchObject({ type: 'document', externalId: 'F123' });
    expect(ctx.saveCursor).toHaveBeenCalledWith('slack.channel:C123', {
      latest_ts: '1782000001.000200',
    });
  });

  it('paginates Slack channel history until Slack returns no next cursor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
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

    await slackProvider.backfill({
      integration: { id: 'integration-1' } as never,
      tokens: { access_token: 'xoxb-token', team: { id: 'T123', name: 'Acme' } },
      selections: [{ kind: 'slack.channel', externalId: 'C123' }],
      ctx,
    });

    const historyCalls = fetch.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/conversations.history'),
    );
    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
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
    expect(ctx.saveCursor).toHaveBeenCalledWith('slack.channel:C123', {
      latest_ts: '1782000006.000100',
    });
  });

  it('uses an incremental lookback so older edits and reactions are not skipped', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (typeof input !== 'string') throw new Error('expected Slack URL string');
      const requestBody = init?.body;
      if (typeof requestBody !== 'string') throw new Error('expected form request body');
      const params = new URLSearchParams(requestBody);
      if (input.endsWith('/conversations.history')) {
        expect(Number(params.get('oldest'))).toBeLessThan(1782000100);
        expect(params.get('inclusive')).toBe('true');
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

    const events = (ctx.writeEvents.mock.calls[0]?.[0] ?? []) as IntegrationEvent[];
    expect(events.map((event) => event.eventType)).toEqual(['message.edited', 'reaction.added']);
    expect(ctx.saveCursor).toHaveBeenCalledWith('slack.channel:C123', {
      latest_ts: '1782000100.000000',
    });
  });
});
