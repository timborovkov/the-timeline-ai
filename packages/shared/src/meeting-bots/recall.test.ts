import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { createRecallProvider } from '#src/meeting-bots/recall.js';

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-test-secret';
  process.env.DATABASE_URL = 'postgres://x';
  process.env.RECALL_API_KEY = 'test-token';
  process.env.RECALL_BASE_URL = 'https://api.recall.test/v1';
  process.env.RECALL_BOT_DISPLAY_NAME = 'Timeline';
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

function makeFetcher(responder: (input: { url: string; init: RequestInit }) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(responder({ url, init: init ?? {} }));
  };
  return { fetcher, calls };
}

describe('createRecallProvider', () => {
  it('joinMeeting posts to /bot with Token auth, metadata round-trip, minimal retention, and silent config', async () => {
    const { fetcher, calls } = makeFetcher(() => Response.json({ id: 'bot-123' }));
    const provider = createRecallProvider({ fetcher });
    const result = await provider.joinMeeting({
      meetingId: 'm-1',
      teamId: 't-1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'meet',
      transcriptWebhookUrl: 'https://example.com/webhook',
    });
    expect(result.botId).toBe('bot-123');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('no call');
    expect(call.url).toBe('https://api.recall.test/v1/bot');
    expect(call.init.method).toBe('POST');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Token test-token');
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.meeting_url).toBe('https://meet.google.com/abc-defg-hij');
    const meta = body.metadata as Record<string, string>;
    expect(meta.meeting_id).toBe('m-1');
    expect(meta.team_id).toBe('t-1');
    expect(meta.platform).toBe('meet');
    expect(body.recording_config).toMatchObject({
      retention: { type: 'timed', hours: 1 },
      transcript: {
        provider: {
          recallai_streaming: {
            mode: 'prioritize_accuracy',
            language_code: 'auto',
          },
        },
      },
    });
    expect(body.output_media).toBeUndefined();
  });

  it('joinMeeting uses configured timed retention for multilingual meetings', async () => {
    process.env.RECALL_RETENTION = '24';
    resetEnvForTests();
    const { fetcher, calls } = makeFetcher(() => Response.json({ id: 'bot-123' }));
    const provider = createRecallProvider({ fetcher });
    await provider.joinMeeting({
      meetingId: 'm-1',
      teamId: 't-1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'meet',
      transcriptWebhookUrl: 'https://example.com/webhook',
    });

    const call = calls[0];
    if (!call) throw new Error('no call');
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.recording_config).toMatchObject({
      retention: { type: 'timed', hours: 24 },
      transcript: {
        provider: {
          recallai_streaming: {
            language_code: 'auto',
            mode: 'prioritize_accuracy',
          },
        },
      },
    });
  });

  it('joinMeeting supports forever retention when explicitly configured', async () => {
    process.env.RECALL_RETENTION = 'forever';
    resetEnvForTests();
    const { fetcher, calls } = makeFetcher(() => Response.json({ id: 'bot-123' }));
    const provider = createRecallProvider({ fetcher });
    await provider.joinMeeting({
      meetingId: 'm-1',
      teamId: 't-1',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'meet',
      transcriptWebhookUrl: 'https://example.com/webhook',
    });

    const call = calls[0];
    if (!call) throw new Error('no call');
    const body = JSON.parse(call.init.body as string) as Record<string, unknown>;
    expect(body.recording_config).toMatchObject({
      retention: { type: 'forever' },
    });
  });

  it.each(['tomorrow-ish', '0', 'zero', 'none', 'null'])(
    'constructor rejects invalid RECALL_RETENTION value %s',
    (value) => {
      process.env.RECALL_RETENTION = value;
      resetEnvForTests();
      expect(() => createRecallProvider()).toThrow(/RECALL_RETENTION/);
    },
  );

  it('joinMeeting throws on non-2xx', async () => {
    const { fetcher } = makeFetcher(() => new Response('boom', { status: 500, statusText: 'err' }));
    const provider = createRecallProvider({ fetcher });
    await expect(
      provider.joinMeeting({
        meetingId: 'm',
        teamId: 't',
        meetingUrl: 'https://zoom.us/j/1',
        platform: 'zoom',
        transcriptWebhookUrl: 'https://x',
      }),
    ).rejects.toThrow(/Recall POST.*500/);
  });

  it('leaveMeeting tolerates 404 (idempotent re-leave)', async () => {
    const { fetcher } = makeFetcher(() => new Response(null, { status: 404 }));
    const provider = createRecallProvider({ fetcher });
    await expect(provider.leaveMeeting('bot-x')).resolves.toBeUndefined();
  });

  it('getStatus maps lifecycle codes to our enum', async () => {
    const { fetcher } = makeFetcher(() =>
      Response.json({
        id: 'bot-1',
        status: { code: 'in_call_recording', created_at: '2026-05-25T10:00:00Z' },
        status_changes: [{ code: 'in_call_recording', created_at: '2026-05-25T10:00:05Z' }],
      }),
    );
    const provider = createRecallProvider({ fetcher });
    const status = await provider.getStatus('bot-1');
    expect(status.status).toBe('active');
    expect(status.rawStatus).toBe('in_call_recording');
    expect(status.startedAt).toBeInstanceOf(Date);
  });

  it('constructor throws when RECALL_API_KEY is missing', () => {
    delete process.env.RECALL_API_KEY;
    resetEnvForTests();
    expect(() => createRecallProvider()).toThrow(/RECALL_API_KEY/);
  });
});
