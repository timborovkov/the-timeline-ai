import { setTimeout as delay } from 'node:timers/promises';

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

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    const json: unknown = await response.json();
    return json;
  } catch {
    return null;
  }
}

function parseTranscriptionResponse(payload: unknown): { text: string; costUsd?: number } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.text !== 'string') return null;
  const usage =
    record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
      ? (record.usage as Record<string, unknown>)
      : null;
  const costUsd = finiteNonNegative(usage?.cost);
  return { text: record.text, ...(costUsd === undefined ? {} : { costUsd }) };
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
      let response: Response;
      try {
        response = await fetchImpl(
          `${OPENROUTER_TRANSCRIPTION_EVAL_BASE_URL}/audio/transcriptions`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'X-OpenRouter-Cache': 'false',
            },
            body: JSON.stringify({
              model: input.modelId,
              input_audio: {
                data: input.audio.toString('base64'),
                format: input.format,
              },
              response_format: 'json',
            }),
            signal: AbortSignal.timeout(input.timeoutMs),
          },
        );
      } catch (error) {
        const category =
          error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
            ? 'timeout'
            : 'provider';
        throw new TranscriptionEvalRequestError(category, elapsedMs(startedAt, nowMs));
      }
      const latencyMs = elapsedMs(startedAt, nowMs);
      if (!response.ok) {
        throw new TranscriptionEvalRequestError(errorCategoryForStatus(response.status), latencyMs);
      }
      const parsed = parseTranscriptionResponse(await jsonOrNull(response));
      if (!parsed) throw new TranscriptionEvalRequestError('invalid_response', latencyMs);

      const route = await fetchGenerationRoute(
        response.headers.get('x-generation-id'),
        options.apiKey,
        fetchImpl,
      );
      const costUsd = parsed.costUsd ?? route.totalCostUsd;
      return {
        ok: true,
        text: parsed.text,
        latencyMs,
        ...(costUsd === undefined ? {} : { costUsd }),
        ...(route.provider ? { provider: route.provider } : {}),
        ...(route.dataRegion ? { dataRegion: route.dataRegion } : {}),
      };
    },
  };
}
