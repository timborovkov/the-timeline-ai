import { afterEach, describe, expect, it, vi } from 'vitest';

import { SlackApi } from '#src/slack/api.js';

describe('SlackApi message posting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
