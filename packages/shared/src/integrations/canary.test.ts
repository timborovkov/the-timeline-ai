import { describe, expect, it } from 'vitest';

import {
  TRANSCRIPTION_SPEECH_CANARY_TEXT,
  buildOpenRouterZdrCanaryRequest,
  buildOpenRouterZdrCanaryTargets,
  buildSpeechTranscriptionCanaryMp3,
  buildPostmarkInboundCaptureCanaryPayload,
  buildSlackEventCaptureCanaryPayload,
  buildTelegramCaptureCanaryPayload,
  buildTranscriptionCanaryWav,
  completeLiveIntegrationCanaryCleanup,
  formatLiveIntegrationCanaryReport,
  inspectOpenRouterZdrRegistry,
  isExpectedSpeechTranscriptionCanaryText,
  redactLiveIntegrationCanaryText,
  runOpenRouterZdrCanaries,
  signSlackCanaryRequest,
  validatePostmarkInboundCaptureCanaryUrl,
  validateSlackEventCaptureCanaryUrl,
  validateTelegramCaptureCanaryUrl,
} from '#src/integrations/canary.js';
import { TIMELINE_MODELS, timelineModelEntries } from '#src/llm/models.js';
import {
  OPENROUTER_DISABLE_CACHE_HEADERS,
  OPENROUTER_OFFICIAL_BASE_URL,
  OPENROUTER_PRIVATE_PROVIDER_ROUTING,
} from '#src/llm/privacy.js';

function serializedRequestBody(body: unknown): string {
  if (typeof body !== 'string') throw new Error('Expected a serialized JSON request body');
  return body;
}

function requestInputUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === 'object' && 'url' in input && typeof input.url === 'string') {
    return input.url;
  }
  throw new Error('Expected a URL-compatible fetch input');
}

// These tests prove the live probe reaches every current ZDR-required model
// surface with the shared fail-closed policy and never returns provider content.
describe('OpenRouter authenticated ZDR model canaries', () => {
  it('covers every ZDR-required role once per unique model surface and excludes transcription', () => {
    const targets = buildOpenRouterZdrCanaryTargets();

    expect(targets).toEqual([
      {
        kind: 'structured',
        modelId: 'deepseek/deepseek-v4-flash-0731',
        roles: ['extraction', 'agent', 'summarization', 'taskCategorization'],
      },
      {
        kind: 'structured',
        modelId: 'deepseek/deepseek-v4-pro',
        roles: ['structuredFallback'],
      },
      {
        kind: 'vision',
        modelId: 'google/gemini-3.5-flash',
        roles: ['vision'],
      },
      {
        kind: 'embedding',
        modelId: 'openai/text-embedding-3-small',
        roles: ['embedding'],
        embeddingDimensions: 1536,
      },
    ]);
    expect(targets.flatMap((target) => target.roles).sort()).toEqual(
      timelineModelEntries()
        .filter(([, model]) => model.privacyMode === 'zdr_required')
        .map(([role]) => role)
        .sort(),
    );
    expect(targets.map((target) => target.modelId)).not.toContain(TIMELINE_MODELS.transcription.id);
  });

  it('serializes every request to the official origin with ZDR, deny, and cache controls', () => {
    for (const target of buildOpenRouterZdrCanaryTargets()) {
      const request = buildOpenRouterZdrCanaryRequest(target, 'shared-openrouter-key');
      const headers = new Headers(request.init.headers);
      const body = JSON.parse(serializedRequestBody(request.init.body)) as Record<string, unknown>;
      const provider = body.provider as Record<string, unknown>;

      expect(request.url.startsWith(`${OPENROUTER_OFFICIAL_BASE_URL}/`)).toBe(true);
      expect(request.url).toBe(
        `${OPENROUTER_OFFICIAL_BASE_URL}/${
          target.kind === 'embedding' ? 'embeddings' : 'chat/completions'
        }`,
      );
      expect(headers.get('authorization')).toBe('Bearer shared-openrouter-key');
      expect(headers.get('x-openrouter-cache')).toBe(
        OPENROUTER_DISABLE_CACHE_HEADERS['X-OpenRouter-Cache'],
      );
      expect(body.model).toBe(target.modelId);
      expect(provider).toMatchObject(OPENROUTER_PRIVATE_PROVIDER_ROUTING);
      expect(provider.only).toBeUndefined();
      expect(provider.order).toBeUndefined();
      expect(provider.ignore).toBeUndefined();
      expect(body.user).toBeUndefined();
      expect(body.models).toBeUndefined();

      if (target.kind === 'embedding') {
        expect(body.dimensions).toBe(1536);
      } else {
        expect(provider.require_parameters).toBe(true);
        expect(body.response_format).toBeDefined();
      }
      if (target.kind === 'vision') {
        expect(JSON.stringify(body)).toContain('data:image/png;base64,');
      }
    }
  });

  it('issues all authenticated requests with one key and returns content-free outcomes', async () => {
    const requests: { body: Record<string, unknown>; headers: Headers; url: string }[] = [];
    const providerOnlyContent = 'provider-output-must-not-be-recorded';
    const fetchImpl: typeof globalThis.fetch = (input, init) => {
      const url = requestInputUrl(input);
      const body = JSON.parse(serializedRequestBody(init?.body)) as Record<string, unknown>;
      requests.push({ body, headers: new Headers(init?.headers), url });
      if (url.endsWith('/embeddings')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: [{ embedding: new Array<number>(1536).fill(0.01) }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            providerOnlyContent,
            choices: [
              {
                message: {
                  content: JSON.stringify({ status: 'ok' }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcomes = await runOpenRouterZdrCanaries({
      apiKey: 'one-shared-key',
      fetch: fetchImpl,
    });

    expect(requests).toHaveLength(4);
    expect(
      requests.every(({ headers }) => headers.get('authorization') === 'Bearer one-shared-key'),
    ).toBe(true);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(JSON.stringify(outcomes)).not.toContain(providerOnlyContent);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: TIMELINE_MODELS.structuredFallback.id, ok: true }),
        expect.objectContaining({ modelId: TIMELINE_MODELS.vision.id, ok: true }),
        expect.objectContaining({ modelId: TIMELINE_MODELS.embedding.id, ok: true }),
      ]),
    );
  });

  it('reports only bounded status metadata when a provider returns content or an error body', async () => {
    const sensitiveBody = 'provider-secret-or-echoed-content';
    const fetchImpl: typeof globalThis.fetch = (_input, init) => {
      const body = JSON.parse(serializedRequestBody(init?.body)) as Record<string, unknown>;
      if (body.model === TIMELINE_MODELS.structuredFallback.id) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: sensitiveBody } }), { status: 403 }),
        );
      }
      if (body.model === TIMELINE_MODELS.embedding.id) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ data: [{ embedding: new Array<number>(1536).fill(0.01) }] }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: 'ok' }) } }] }),
          { status: 200 },
        ),
      );
    };

    const outcomes = await runOpenRouterZdrCanaries({ apiKey: 'shared-key', fetch: fetchImpl });

    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: TIMELINE_MODELS.structuredFallback.id,
          ok: false,
          reason: 'http_error',
          status: 403,
        }),
      ]),
    );
    expect(JSON.stringify(outcomes)).not.toContain(sensitiveBody);
  });
});

describe('inspectOpenRouterZdrRegistry', () => {
  it('counts endpoints for every exact ZDR-classified model id', () => {
    expect(
      inspectOpenRouterZdrRegistry(
        {
          data: [
            { model_id: 'deepseek/deepseek-v4-flash-0731', provider_name: 'Provider A' },
            { model_id: 'google/gemini-3.5-flash', provider_name: 'Provider B' },
            { model_id: 'deepseek/deepseek-v4-flash-0731', provider_name: 'Provider C' },
          ],
        },
        ['deepseek/deepseek-v4-flash-0731', 'google/gemini-3.5-flash'],
      ),
    ).toEqual({
      ok: true,
      models: [
        { endpointCount: 2, modelId: 'deepseek/deepseek-v4-flash-0731' },
        { endpointCount: 1, modelId: 'google/gemini-3.5-flash' },
      ],
    });
  });

  it('reports every ZDR-classified model missing from a valid registry', () => {
    expect(
      inspectOpenRouterZdrRegistry(
        {
          data: [{ model_id: 'deepseek/deepseek-v4-flash-0731', provider_name: 'Provider A' }],
        },
        [
          'deepseek/deepseek-v4-flash-0731',
          'google/gemini-3.5-flash',
          'openai/text-embedding-3-small',
        ],
      ),
    ).toEqual({
      ok: false,
      reason: 'models_absent',
      detail:
        'Public ZDR registry has no endpoint for: google/gemini-3.5-flash, openai/text-embedding-3-small',
      missingModelIds: ['google/gemini-3.5-flash', 'openai/text-embedding-3-small'],
    });
  });

  it('fails closed when the canary is not given a ZDR-required model', () => {
    expect(inspectOpenRouterZdrRegistry({ data: [] }, [])).toEqual({
      ok: false,
      reason: 'invalid_request',
      detail: 'At least one non-empty ZDR-required model id must be inspected',
    });
  });

  it.each([
    { payload: null, detail: 'ZDR registry response is not an object' },
    { payload: {}, detail: 'ZDR registry response.data is not an array' },
    {
      payload: { data: [null] },
      detail: 'ZDR registry response.data[0] is not an object',
    },
    {
      payload: { data: [{ model_id: '' }] },
      detail: 'ZDR registry response.data[0].model_id is not a non-empty string',
    },
  ])('rejects a malformed registry payload: $detail', ({ payload, detail }) => {
    expect(inspectOpenRouterZdrRegistry(payload, ['deepseek/deepseek-v4-flash-0731'])).toEqual({
      ok: false,
      reason: 'invalid_response',
      detail,
    });
  });
});

describe('live integration canary report formatting', () => {
  it('prints status rows and actionable next steps without exposing secrets', () => {
    const report = formatLiveIntegrationCanaryReport({
      envFile: '/path/to/.env',
      strict: true,
      results: [
        {
          name: 'OpenRouter',
          status: 'ok',
          detail: 'shared structured LLM path succeeded',
        },
        {
          name: 'GitHub App',
          status: 'skip',
          detail: 'GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY missing',
          action: 'configure GitHub App installation-token credentials',
          envKeys: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
          docs: 'docs/setup/integrations.html#github',
        },
        {
          name: 'Sentry API',
          status: 'warn',
          detail: 'status 403: You do not have permission',
          action: 'grant the Sentry token project:read access to the configured project',
          docs: 'docs/setup/sentry.html',
        },
        {
          name: 'Postmark API',
          status: 'ok',
          detail: 'server lookup succeeded',
        },
      ],
    });

    expect(report).toContain('Live integration canary (/path/to/.env, strict)');
    expect(report).toContain('OK   OpenRouter: shared structured LLM path succeeded');
    expect(report).toContain('OK   Postmark API: server lookup succeeded');
    expect(report).toContain('SKIP GitHub App: GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY missing');
    expect(report).toContain('WARN Sentry API: status 403: You do not have permission');
    expect(report).toContain('Next steps:');
    expect(report).toContain(
      '- GitHub App: configure GitHub App installation-token credentials; set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY; see docs/setup/integrations.html#github',
    );
    expect(report).toContain(
      '- Sentry API: grant the Sentry token project:read access to the configured project; see docs/setup/sentry.html',
    );
    expect(report).not.toContain('ghp_');
    expect(report).not.toContain('secret=');
    expect(report).not.toContain('POSTMARK_SERVER_TOKEN=');
  });

  it('omits the next-steps section when every check is ok', () => {
    expect(
      formatLiveIntegrationCanaryReport({
        envFile: '.env',
        results: [{ name: 'OpenRouter', status: 'ok', detail: 'ok' }],
      }),
    ).toBe('Live integration canary (.env)\nOK   OpenRouter: ok');
  });

  it('redacts configured secrets and generic authorization tokens from report text', () => {
    const secret = 'pm-secret-value-123456';
    const report = formatLiveIntegrationCanaryReport({
      envFile: '.env',
      redactions: [secret],
      results: [
        {
          name: 'Postmark API',
          status: 'warn',
          detail: `status 401: token ${secret} rejected`,
        },
        {
          name: 'Fallback',
          status: 'warn',
          detail: [
            'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
            'Authorization: Basic cG9zdG1hcms6cG0tc2VjcmV0LXZhbHVlLTEyMzQ1Ng==',
          ].join('\n'),
        },
      ],
    });

    expect(report).not.toContain(secret);
    expect(report).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(report).not.toContain('cG9zdG1hcms6cG0tc2VjcmV0LXZhbHVlLTEyMzQ1Ng==');
    expect(report).toContain('token [redacted] rejected');
    expect(report).toContain('Authorization: [redacted] [redacted]');
  });
});

describe('temporary live canary cleanup', () => {
  it('downgrades a successful check when its temporary resource cannot be removed', async () => {
    const result = await completeLiveIntegrationCanaryCleanup({
      success: { name: 'Monday board sync contract', status: 'ok', detail: 'webhook created' },
      cleanup: () => Promise.reject(new Error('delete denied')),
      formatError: (error) => (error instanceof Error ? error.message : String(error)),
      action: 'remove the temporary webhook and verify webhook scopes',
      docs: 'docs/setup/integrations.html#monday',
    });

    expect(result).toEqual({
      name: 'Monday board sync contract',
      status: 'warn',
      detail: 'cleanup failed: delete denied',
      action: 'remove the temporary webhook and verify webhook scopes',
      docs: 'docs/setup/integrations.html#monday',
    });
  });
});

describe('redactLiveIntegrationCanaryText', () => {
  it('redacts encoded secret values and sensitive headers', () => {
    expect(
      redactLiveIntegrationCanaryText(
        'x-postmark-server-token: pm-token-1234567890 and token%2Fwith%2Fslash',
        ['token/with/slash'],
      ),
    ).toBe('x-postmark-server-token: [redacted] and [redacted]');
  });
});

describe('buildPostmarkInboundCaptureCanaryPayload', () => {
  it('builds a Postmark-shaped payload for the inbound capture route', () => {
    const payload = buildPostmarkInboundCaptureCanaryPayload({
      messageId: 'timeline-canary@example.test',
      to: 'team-a@inbound.test',
      from: 'canary@example.test',
      date: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(payload).toMatchObject({
      MessageID: 'timeline-canary@example.test',
      Subject: 'Timeline inbound canary 2026-07-01T12:00:00.000Z',
      FromFull: { Email: 'canary@example.test', Name: 'Timeline Canary' },
      ToFull: [{ Email: 'team-a@inbound.test', Name: 'Timeline Canary Team' }],
      OriginalRecipient: 'team-a@inbound.test',
      Tag: 'timeline-canary',
      Attachments: [],
    });
    expect(payload.TextBody).toContain('timeline-canary@example.test');
    expect(payload.Headers).toEqual([
      { Name: 'Message-ID', Value: '<timeline-canary@example.test>' },
    ]);
  });
});

describe('buildSlackEventCaptureCanaryPayload', () => {
  it('builds a Slack event-callback payload for capture canaries', () => {
    expect(
      buildSlackEventCaptureCanaryPayload({
        eventId: 'EvCanary',
        teamId: 'T123',
        channelId: 'C123',
        userId: 'U123',
        text: 'Timeline Slack capture canary',
        messageTs: '1780000000.123456',
        eventTime: 1_780_000_000,
      }),
    ).toEqual({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'EvCanary',
      event_time: 1_780_000_000,
      event: {
        type: 'message',
        channel: 'C123',
        channel_type: 'channel',
        user: 'U123',
        text: 'Timeline Slack capture canary',
        ts: '1780000000.123456',
        event_ts: '1780000000.123456',
      },
    });
  });
});

describe('buildTelegramCaptureCanaryPayload', () => {
  it('builds a Telegram private-message update for capture canaries', () => {
    expect(
      buildTelegramCaptureCanaryPayload({
        updateId: 1_780_000_001,
        messageId: 42,
        userId: 710_000_001,
        username: 'timeline_canary',
        firstName: 'Timeline',
        text: 'Timeline Telegram capture canary',
        date: 1_780_000_000,
      }),
    ).toEqual({
      update_id: 1_780_000_001,
      message: {
        message_id: 42,
        date: 1_780_000_000,
        chat: { id: 710_000_001, type: 'private' },
        from: {
          id: 710_000_001,
          is_bot: false,
          first_name: 'Timeline',
          username: 'timeline_canary',
        },
        text: '/note Timeline Telegram capture canary',
      },
    });
  });
});

describe('buildTranscriptionCanaryWav', () => {
  it('builds a small PCM WAV buffer for live transcription canaries', () => {
    const wav = buildTranscriptionCanaryWav({
      durationMs: 250,
      frequencyHz: 880,
      sampleRateHz: 8_000,
    });

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(8_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(wav.byteLength - 44);
    expect(wav.byteLength).toBe(44 + 2_000 * 2);
  });
});

describe('buildSpeechTranscriptionCanaryMp3', () => {
  it('builds a tiny spoken MP3 fixture for live transcription canaries', () => {
    const mp3 = buildSpeechTranscriptionCanaryMp3();

    expect(TRANSCRIPTION_SPEECH_CANARY_TEXT).toBe('Timeline Canary task');
    expect(mp3.subarray(0, 3).toString('ascii')).toBe('ID3');
    expect(mp3.byteLength).toBeGreaterThan(4_000);
    expect(mp3.byteLength).toBeLessThan(8_000);
  });

  it('matches expected speech canary transcripts semantically', () => {
    expect(isExpectedSpeechTranscriptionCanaryText('Timeline Canary task.')).toBe(true);
    expect(isExpectedSpeechTranscriptionCanaryText('timeline canary: create a task')).toBe(true);
    expect(isExpectedSpeechTranscriptionCanaryText('audio endpoint returned text')).toBe(false);
  });
});

describe('signSlackCanaryRequest', () => {
  it('signs the exact request body with Slack v0 HMAC format', () => {
    const body = JSON.stringify({ type: 'event_callback', event_id: 'EvCanary' });

    expect(
      signSlackCanaryRequest({
        signingSecret: 'slack-secret',
        timestamp: '1780000000',
        body,
      }),
    ).toBe('v0=b3bb3da7e1b4dcf99ffbc56b257ed453ef5e101bf0a720690ed5ab989646c11e');
  });
});

describe('validatePostmarkInboundCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validatePostmarkInboundCaptureCanaryUrl(
        'https://timeline.example/app',
        'https://timeline.example',
      ),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/email/inbound'),
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('http://localhost:3000', undefined),
    ).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/email/inbound'),
    });
  });

  it('rejects missing, malformed, and non-local HTTP origins before secrets are sent', () => {
    expect(validatePostmarkInboundCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('not a url', 'https://timeline.example'),
    ).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validatePostmarkInboundCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validatePostmarkInboundCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});

describe('validateSlackEventCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validateSlackEventCaptureCanaryUrl(
        'https://timeline.example/app',
        'https://timeline.example',
      ),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/slack/events'),
    });
    expect(validateSlackEventCaptureCanaryUrl('http://localhost:3000', undefined)).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/slack/events'),
    });
  });

  it('rejects missing, malformed, and unconfirmed non-local origins before signing payloads', () => {
    expect(validateSlackEventCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(validateSlackEventCaptureCanaryUrl('not a url', 'https://timeline.example')).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validateSlackEventCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validateSlackEventCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validateSlackEventCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});

describe('validateTelegramCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validateTelegramCaptureCanaryUrl('https://timeline.example/app', 'https://timeline.example'),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/telegram/webhook'),
    });
    expect(validateTelegramCaptureCanaryUrl('http://localhost:3000', undefined)).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/telegram/webhook'),
    });
  });

  it('rejects missing, malformed, and unconfirmed non-local origins before sending secrets', () => {
    expect(validateTelegramCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(validateTelegramCaptureCanaryUrl('not a url', 'https://timeline.example')).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validateTelegramCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validateTelegramCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validateTelegramCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});
