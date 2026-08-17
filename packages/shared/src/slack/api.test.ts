import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#src/http/external-fetch.js', () => ({
  externalFetch: (input: string | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import { SlackApi } from '#src/slack/api.js';

describe('SlackApi message posting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls auth.test with the configured bearer token', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          team_id: 'T123',
          user_id: 'U123',
          bot_id: 'B123',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new SlackApi('xoxb-test').authTest()).resolves.toMatchObject({
      team_id: 'T123',
      user_id: 'U123',
      bot_id: 'B123',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://slack.com/api/auth.test');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer xoxb-test',
      'content-type': 'application/x-www-form-urlencoded',
    });
  });

  it('disables Slack mrkdwn for chat.postMessage text', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await new SlackApi('xoxb-test').postMessage({
      channel: 'C123',
      text: 'Meeting with **DFK:n** [ev:123]',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(URLSearchParams);
    const body = init.body as URLSearchParams;
    expect(body.get('text')).toBe('Meeting with **DFK:n** [ev:123]');
    expect(body.get('mrkdwn')).toBe('false');
  });

  it('disables Slack mrkdwn for response_url replies', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await new SlackApi('xoxb-test').postMessage({
      channel: 'C123',
      response_url: 'https://hooks.slack.test/response',
      text: 'Meeting with **DFK:n** [ev:123]',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(typeof init.body).toBe('string');
    const body = typeof init.body === 'string' ? init.body : '';
    expect(JSON.parse(body)).toMatchObject({
      text: 'Meeting with **DFK:n** [ev:123]',
      mrkdwn: false,
      response_type: 'ephemeral',
    });
  });
});

describe('SlackApi deterministic E2E seam', () => {
  afterEach(() => {
    delete process.env.E2E_DETERMINISTIC_SLACK_API;
    vi.unstubAllGlobals();
  });

  it('serves seeded conversation fixtures without calling Slack', async () => {
    process.env.E2E_DETERMINISTIC_SLACK_API = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const conversations = await new SlackApi('xoxb-test').conversationsList();
    const supportInfo = await new SlackApi('xoxb-test').conversationsInfo('C_E2E_SUPPORT');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'C_E2E_SUPPORT', name: 'support' }),
        expect.objectContaining({ id: 'C_E2E_PRIVATE', name: 'private-plans' }),
      ]),
    );
    expect(supportInfo).toEqual(expect.objectContaining({ id: 'C_E2E_SUPPORT', name: 'support' }));
  });

  it('opens a direct-message conversation before posting', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true, channel: { id: 'D123' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new SlackApi('xoxb-test').conversationsOpen('U123')).resolves.toEqual({
      id: 'D123',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://slack.com/api/conversations.open');
    expect(String(init.body)).toContain('users=U123');
  });
});

describe('SlackApi file downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects files whose Content-Length exceeds the byte limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { headers: { 'content-length': '6' } }))),
    );

    await expect(
      new SlackApi('xoxb-test').downloadFile(
        { id: 'F1', url_private_download: 'https://files.example/large.bin' },
        5,
      ),
    ).rejects.toThrow('file_oversize');
  });

  it('rejects streamed files that exceed the byte limit without provider metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(Buffer.from('123456')))),
    );

    await expect(
      new SlackApi('xoxb-test').downloadFile(
        { id: 'F1', url_private_download: 'https://files.example/large.bin' },
        5,
      ),
    ).rejects.toThrow('file_oversize');
  });
});
