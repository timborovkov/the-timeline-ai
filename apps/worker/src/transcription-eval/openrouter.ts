import { setTimeout as delay } from 'node:timers/promises';

import {
  OpenRouterTranscriptionHttpError,
  TimelineAiError,
  transcribeAudio,
} from '@timeline/shared/llm';

import type {
  TranscriptionEvalTransport,
  TranscriptionEvalTransportRequest,
  TranscriptionEvalZdrRoutes,
} from '#src/transcription-eval/evaluate.js';
import type { TranscriptionEvalTransportSuccess } from '#src/transcription-eval/metrics.js';

import {
  TranscriptionEvalRequestError,
  TranscriptionQualityEvalError,
} from '#src/transcription-eval/evaluate.js';

export const OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterTranscriptionEvalTransportOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  nowMs?: () => number;
}

interface GenerationRoute {
  provider?: string;
  dataRegion?: string;
  totalCostUsd?: number;
}

interface ZdrRegistryRoute {
  endpointCount: number;
  providers: readonly string[];
  tags: readonly string[];
}

interface EndpointInventory {
  endpointCount: number;
  tags: readonly string[];
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function errorCategoryForStatus(status: number): TranscriptionEvalRequestError['category'] {
  if (status === 400 || status === 415 || status === 422) return 'format';
  if (status === 401 || status === 403) return 'authentication';
  if (status === 402 || status === 429) return 'quota';
  return 'provider';
}

function elapsedMs(startedAt: number, nowMs: () => number): number {
  return Math.max(0, nowMs() - startedAt);
}

function categoryFromTranscriptionFailure(
  error: unknown,
): TranscriptionEvalRequestError['category'] {
  if (error instanceof TimelineAiError) {
    if (error.causeName === 'AbortError' || error.causeName === 'TimeoutError') return 'timeout';
    if (error.causeName === OpenRouterTranscriptionHttpError.name) {
      const status =
        error.cause && typeof error.cause === 'object' && 'status' in error.cause
          ? Number(error.cause.status)
          : Number(/failed with (\d+)/u.exec(error.causeMessage)?.[1]);
      if (Number.isInteger(status) && status > 0) return errorCategoryForStatus(status);
    }
    if (error.causeMessage.includes('did not include text')) return 'invalid_response';
  }
  const cause = error instanceof TimelineAiError ? error.cause : error;
  if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
    return 'timeout';
  }
  return 'provider';
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    const json: unknown = await response.json();
    return json;
  } catch {
    return null;
  }
}

function parseGenerationRoute(payload: unknown): GenerationRoute | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const provider = boundedString(record.provider_name, 100);
  const dataRegion = boundedString(record.data_region, 50);
  const totalCostUsd = finiteNonNegative(record.total_cost);
  return {
    ...(provider ? { provider } : {}),
    ...(dataRegion ? { dataRegion } : {}),
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
  };
}

function parseZdrRoutes(
  payload: unknown,
  modelIds: readonly string[],
): ReadonlyMap<string, ZdrRegistryRoute> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const routes = new Map(
    modelIds.map((modelId) => [
      modelId,
      { endpointCount: 0, providers: new Set<string>(), tags: new Set<string>() },
    ]),
  );
  for (const endpoint of data) {
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return null;
    const record = endpoint as Record<string, unknown>;
    const modelId = record.model_id;
    if (typeof modelId !== 'string' || modelId.trim().length === 0) return null;
    const route = routes.get(modelId);
    if (!route) continue;
    const provider = boundedString(record.provider_name, 100);
    const tag = boundedString(record.tag, 256);
    if (!provider || !tag) return null;
    route.endpointCount += 1;
    route.providers.add(provider);
    route.tags.add(tag);
  }
  return new Map(
    [...routes].map(([modelId, route]) => [
      modelId,
      {
        endpointCount: route.endpointCount,
        providers: [...route.providers].sort(),
        tags: [...route.tags].sort(),
      },
    ]),
  );
}

function parseEndpointInventory(payload: unknown, modelId: string): EndpointInventory | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.id !== modelId || !Array.isArray(record.endpoints) || record.endpoints.length === 0) {
    return null;
  }

  const tags: string[] = [];
  for (const endpoint of record.endpoints) {
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) return null;
    const endpointRecord = endpoint as Record<string, unknown>;
    if (endpointRecord.model_id !== modelId) return null;
    const tag = boundedString(endpointRecord.tag, 256);
    if (!tag) return null;
    tags.push(tag);
  }
  return { endpointCount: record.endpoints.length, tags };
}

function modelEndpointInventoryUrl(modelId: string): string {
  const separator = modelId.indexOf('/');
  if (separator <= 0 || separator === modelId.length - 1) {
    throw new TranscriptionQualityEvalError('Invalid model ID for endpoint inventory');
  }
  const author = encodeURIComponent(modelId.slice(0, separator));
  const slug = encodeURIComponent(modelId.slice(separator + 1));
  return `${OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL}/models/${author}/${slug}/endpoints`;
}

function unavailableRoute(
  route: ZdrRegistryRoute,
  inventoryStatus: 'unavailable' | 'invalid',
): TranscriptionEvalZdrRoutes {
  return {
    ...route,
    inventoryStatus,
    inventoryEndpointCount: 0,
    inventoryTags: [],
    matchedZdrEndpointCount: 0,
    nonZdrEndpointCount: 0,
    allEligibleEndpointsZdr: false,
  };
}

async function inspectEndpointIsolation(
  modelId: string,
  route: ZdrRegistryRoute,
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<TranscriptionEvalZdrRoutes> {
  let response: Response;
  try {
    response = await fetchImpl(modelEndpointInventoryUrl(modelId), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return unavailableRoute(route, 'unavailable');
  }
  if (!response.ok) return unavailableRoute(route, 'unavailable');
  const inventory = parseEndpointInventory(await jsonOrNull(response), modelId);
  if (!inventory) return unavailableRoute(route, 'invalid');

  const zdrTags = new Set(route.tags);
  const matchedZdrEndpointCount = inventory.tags.filter((tag) => zdrTags.has(tag)).length;
  const nonZdrEndpointCount = inventory.endpointCount - matchedZdrEndpointCount;
  return {
    ...route,
    inventoryStatus: 'verified',
    inventoryEndpointCount: inventory.endpointCount,
    inventoryTags: inventory.tags,
    matchedZdrEndpointCount,
    nonZdrEndpointCount,
    allEligibleEndpointsZdr:
      route.endpointCount > 0 &&
      matchedZdrEndpointCount === inventory.endpointCount &&
      nonZdrEndpointCount === 0,
  };
}

async function fetchGenerationRoute(
  generationId: string | null,
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<GenerationRoute> {
  if (!generationId) return {};
  const url = new URL(`${OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL}/generation`);
  url.searchParams.set('id', generationId);

  for (const waitMs of [0, 150, 400]) {
    if (waitMs > 0) await delay(waitMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      return parseGenerationRoute(await jsonOrNull(response)) ?? {};
    } catch {
      // Route metadata is evidence enrichment; the transcription result remains usable.
    }
  }
  return {};
}

export function createOpenRouterTranscriptionEvalTransport(
  options: OpenRouterTranscriptionEvalTransportOptions,
): TranscriptionEvalTransport {
  if (!options.apiKey.trim()) {
    throw new TranscriptionQualityEvalError('OPENROUTER_API_KEY is required for the live eval');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const nowMs = options.nowMs ?? performance.now.bind(performance);

  return {
    async inspectZdrRoutes(modelIds) {
      let response: Response;
      try {
        response = await fetchImpl(`${OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL}/endpoints/zdr`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new TranscriptionQualityEvalError('Could not read the OpenRouter ZDR registry');
      }
      if (!response.ok) {
        throw new TranscriptionQualityEvalError(
          `OpenRouter ZDR registry returned HTTP ${String(response.status)}`,
        );
      }
      const payload = await jsonOrNull(response);
      const routes = parseZdrRoutes(payload, modelIds);
      if (!routes) {
        throw new TranscriptionQualityEvalError('OpenRouter ZDR registry response was invalid');
      }
      return new Map(
        await Promise.all(
          modelIds.map(async (modelId) => {
            const route = routes.get(modelId);
            if (!route) {
              throw new TranscriptionQualityEvalError(
                'OpenRouter ZDR registry inspection omitted a requested model',
              );
            }
            return [
              modelId,
              await inspectEndpointIsolation(modelId, route, options.apiKey, fetchImpl),
            ] as const;
          }),
        ),
      );
    },

    async transcribe(
      input: TranscriptionEvalTransportRequest,
    ): Promise<TranscriptionEvalTransportSuccess> {
      const startedAt = nowMs();
      let transcribed: Awaited<ReturnType<typeof transcribeAudio>>;
      try {
        transcribed = await transcribeAudio(
          {
            audio: input.audio,
            format: input.format,
            modelId: input.modelId,
            timeoutMs: input.timeoutMs,
            responseFormat: 'json',
          },
          {
            apiKey: options.apiKey,
            baseURL: OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL,
            fetch: fetchImpl,
          },
        );
      } catch (error) {
        throw new TranscriptionEvalRequestError(
          categoryFromTranscriptionFailure(error),
          elapsedMs(startedAt, nowMs),
        );
      }
      const latencyMs = elapsedMs(startedAt, nowMs);
      const route = await fetchGenerationRoute(
        transcribed.generationId ?? null,
        options.apiKey,
        fetchImpl,
      );
      const costUsd = transcribed.costUsd ?? route.totalCostUsd;
      return {
        ok: true,
        text: transcribed.text,
        latencyMs,
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.dataRegion ? { dataRegion: route.dataRegion } : {}),
      };
    },
  };
}
