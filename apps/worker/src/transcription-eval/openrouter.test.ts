/**
 * The live transport must use OpenRouter's documented STT/usage contracts,
 * preflight the public ZDR registry, disable response caching, and return only
 * route/cost metadata beside the in-memory hypothesis. All HTTP is mocked here;
 * no API key, audio corpus, or external service is touched.
 */
import { describe, expect, it, vi } from 'vitest';

import { TranscriptionEvalRequestError } from '#src/transcription-eval/evaluate.js';
import {
  createOpenRouterTranscriptionEvalTransport,
  OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL,
} from '#src/transcription-eval/openrouter.js';

describe('OpenRouter transcription eval transport', () => {
  it('preflights ZDR routes and captures aggregate-ready route, cost, and latency data', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/endpoints/zdr')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  model_id: 'openai/whisper-large-v3',
                  provider_name: 'Groq',
                  tag: 'groq/zdr',
                },
                {
                  model_id: 'openai/whisper-large-v3',
                  provider_name: 'Together',
                  tag: 'together/zdr',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.endsWith('/models/openai/whisper-large-v3/endpoints')) {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                id: 'openai/whisper-large-v3',
                endpoints: [
                  { model_id: 'openai/whisper-large-v3', tag: 'groq/zdr' },
                  { model_id: 'openai/whisper-large-v3', tag: 'together/zdr' },
                ],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      if (url.includes('/generation?')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                provider_name: 'Groq',
                data_region: 'global',
                total_cost: 0.003,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      expect(init?.headers).toMatchObject({ 'X-OpenRouter-Cache': 'false' });
      if (typeof init?.body !== 'string') throw new Error('expected JSON request body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'openai/whisper-large-v3',
        input_audio: { data: Buffer.from('synthetic audio').toString('base64'), format: 'wav' },
        response_format: 'json',
      });
      expect(body).not.toHaveProperty('language');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            text: 'synthetic transcript',
            usage: { seconds: 1, cost: 0.002 },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-generation-id': 'gen-synthetic' },
          },
        ),
      );
    });
    const ticks = [100, 225];
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: fetchImpl,
      nowMs: () => ticks.shift() ?? 225,
    });

    const routes = await transport.inspectZdrRoutes(['openai/whisper-large-v3']);
    const result = await transport.transcribe({
      modelId: 'openai/whisper-large-v3',
      audio: Buffer.from('synthetic audio'),
      format: 'wav',
      timeoutMs: 10_000,
    });

    expect(routes).toEqual(
      new Map([
        [
          'openai/whisper-large-v3',
          {
            endpointCount: 2,
            providers: ['Groq', 'Together'],
            tags: ['groq/zdr', 'together/zdr'],
            inventoryStatus: 'verified',
            inventoryEndpointCount: 2,
            inventoryTags: ['groq/zdr', 'together/zdr'],
            matchedZdrEndpointCount: 2,
            nonZdrEndpointCount: 0,
            allEligibleEndpointsZdr: true,
          },
        ],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      text: 'synthetic transcript',
      latencyMs: 125,
      costUsd: 0.002,
      provider: 'Groq',
      dataRegion: 'global',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        href: `${OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL}/generation?id=gen-synthetic`,
      }),
      expect.any(Object),
    );
  });

  it('classifies provider format failures without retaining the provider body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'content-bearing provider diagnostic' } }), {
        status: 415,
      }),
    );
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: fetchImpl,
      nowMs: (() => {
        const ticks = [0, 40];
        return () => ticks.shift() ?? 40;
      })(),
    });

    const request = transport.transcribe({
      modelId: 'openai/whisper-large-v3',
      audio: Buffer.from('synthetic audio'),
      format: 'aac',
      timeoutMs: 10_000,
    });

    await expect(request).rejects.toMatchObject({
      name: 'TranscriptionEvalRequestError',
      category: 'format',
      latencyMs: 40,
    });
    await expect(request).rejects.not.toThrow(/content-bearing/u);
  });

  it('rejects endpoint isolation when the same provider has regular and ZDR siblings', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/endpoints/zdr')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  model_id: 'mistralai/voxtral-mini-transcribe',
                  provider_name: 'Mistral',
                  tag: 'mistral/zdr',
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              id: 'mistralai/voxtral-mini-transcribe',
              endpoints: [
                {
                  model_id: 'mistralai/voxtral-mini-transcribe',
                  provider_name: 'Mistral',
                  tag: 'mistral',
                },
                {
                  model_id: 'mistralai/voxtral-mini-transcribe',
                  provider_name: 'Mistral',
                  tag: 'mistral/zdr',
                },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    });
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: fetchImpl,
    });

    const routes = await transport.inspectZdrRoutes(['mistralai/voxtral-mini-transcribe']);

    expect(routes.get('mistralai/voxtral-mini-transcribe')).toMatchObject({
      endpointCount: 1,
      tags: ['mistral/zdr'],
      inventoryStatus: 'verified',
      inventoryEndpointCount: 2,
      inventoryTags: ['mistral', 'mistral/zdr'],
      matchedZdrEndpointCount: 1,
      nonZdrEndpointCount: 1,
      allEligibleEndpointsZdr: false,
    });
  });

  it.each([
    {
      label: 'is missing',
      status: 404,
      payload: { error: { code: 404 } },
      expected: 'unavailable',
    },
    {
      label: 'is malformed',
      status: 200,
      payload: { data: { endpoints: [] } },
      expected: 'invalid',
    },
  ] as const)('rejects endpoint isolation when full inventory $label', async (inventoryCase) => {
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/endpoints/zdr')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  model_id: 'google/chirp-3',
                  provider_name: 'Google',
                  tag: 'google/zdr',
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(inventoryCase.payload), { status: inventoryCase.status }),
      );
    });
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: fetchImpl,
    });

    const routes = await transport.inspectZdrRoutes(['google/chirp-3']);

    expect(routes.get('google/chirp-3')).toMatchObject({
      inventoryStatus: inventoryCase.expected,
      inventoryEndpointCount: 0,
      matchedZdrEndpointCount: 0,
      nonZdrEndpointCount: 0,
      allEligibleEndpointsZdr: false,
    });
  });

  it('fails closed when the public ZDR registry is malformed', async () => {
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ wrong_key: 'value' }] }), { status: 200 }),
        ),
    });

    await expect(transport.inspectZdrRoutes(['openai/whisper-large-v3'])).rejects.toThrow(
      /registry response was invalid/u,
    );
  });

  it('fails closed when a matched ZDR route omits its provider name', async () => {
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ model_id: 'openai/whisper-large-v3' }] }), {
          status: 200,
        }),
      ),
    });

    await expect(transport.inspectZdrRoutes(['openai/whisper-large-v3'])).rejects.toThrow(
      /registry response was invalid/u,
    );
  });

  it('uses typed errors for invalid transcription responses', async () => {
    const transport = createOpenRouterTranscriptionEvalTransport({
      apiKey: 'test-key',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ usage: { cost: 0.001 } }), { status: 200 }),
        ),
      nowMs: () => 10,
    });

    await expect(
      transport.transcribe({
        modelId: 'openai/whisper-large-v3',
        audio: Buffer.from('synthetic audio'),
        format: 'mp3',
        timeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(TranscriptionEvalRequestError);
  });
});
