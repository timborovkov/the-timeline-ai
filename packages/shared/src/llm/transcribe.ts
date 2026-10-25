import { type TranscriptionModel } from 'ai';

import { digestAiBytes } from '#src/billing/ai-call.js';
import { openRouterFinishFromAiResult } from '#src/billing/openrouter-usage.js';
import { withAiMetering } from '#src/billing/runtime.js';
import { getEnv } from '#src/env.js';
import { wrapAiFailure } from '#src/llm/errors.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  OPENROUTER_DISABLE_CACHE_HEADERS,
  OPENROUTER_OFFICIAL_BASE_URL,
} from '#src/llm/privacy.js';
import { transcribe as tracedTranscribe } from '#src/llm/tracing.js';

export interface TranscribeInput {
  /** Raw audio bytes. OpenRouter STT accepts JSON with base64 audio data and a format hint. */
  audio: Buffer;
  format?: AudioFormat;
  /** ISO-639-1 language hint (e.g. 'fi', 'en', 'de'). Improves accuracy
   *  for non-English audio. Omit for auto-detection. */
  language?: string;
  /** Stable billing id for this chunk. A retry of the same chunk reuses it. */
  operationId?: string;
  /** Eval bake-off override. Production callers omit this and use the pin. */
  modelId?: string;
  timeoutMs?: number;
  responseFormat?: 'json';
}

export interface TranscribeResult {
  text: string;
  model: string;
  costUsd?: number;
  generationId?: string | null;
}

export interface TranscribeDeps {
  /**
   * Inject a pre-built TranscriptionModel for tests. Same shape as
   * chat.ts/embed.ts so the three LLM ops have a consistent test pattern.
   */
  model?: TranscriptionModel;
  fetch?: typeof globalThis.fetch;
  /** Explicit inference key so eval callers can skip the shared env loader. */
  apiKey?: string;
  baseURL?: string;
}

export class OpenRouterTranscriptionHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`OpenRouter transcription failed with ${status}`);
    this.name = 'OpenRouterTranscriptionHttpError';
    this.status = status;
  }
}

export type AudioFormat = 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg' | 'webm' | 'aac';

function resolveModelId(override?: string): string {
  return override ?? TIMELINE_MODELS.transcription.id;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function resolveOpenRouterTranscriptionConfig(deps: { apiKey?: string; baseURL?: string }): {
  apiKey: string;
  baseURL: string;
} {
  if (deps.apiKey) {
    return {
      apiKey: deps.apiKey,
      baseURL: (deps.baseURL ?? OPENROUTER_OFFICIAL_BASE_URL).replace(/\/+$/u, ''),
    };
  }
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for transcription');
  }
  return {
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: (deps.baseURL ?? env.OPENROUTER_BASE_URL ?? OPENROUTER_OFFICIAL_BASE_URL).replace(
      /\/+$/u,
      '',
    ),
  };
}

function inferAudioFormat(audio: Buffer): AudioFormat {
  if (audio.subarray(0, 4).toString('ascii') === 'RIFF') return 'wav';
  if (audio.subarray(0, 3).toString('ascii') === 'ID3' || audio[0] === 0xff) return 'mp3';
  if (audio.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (audio.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (audio[0] === 0x1a && audio[1] === 0x45 && audio[2] === 0xdf && audio[3] === 0xa3) {
    return 'webm';
  }
  if (audio.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a';
  if (audio[0] === 0xff && ((audio[1] ?? 0) & 0xf0) === 0xf0) return 'aac';
  return 'm4a';
}

async function transcribeWithOpenRouterJson(
  input: TranscribeInput,
  opts: { modelId: string; fetch: typeof globalThis.fetch; apiKey?: string; baseURL?: string },
): Promise<{
  value: TranscribeResult;
  finish: ReturnType<typeof openRouterFinishFromAiResult>;
}> {
  const { apiKey, baseURL } = resolveOpenRouterTranscriptionConfig(opts);
  const response = await opts.fetch(`${baseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...OPENROUTER_DISABLE_CACHE_HEADERS,
    },
    body: JSON.stringify({
      model: opts.modelId,
      input_audio: {
        data: input.audio.toString('base64'),
        format: input.format ?? inferAudioFormat(input.audio),
      },
      ...(input.language ? { language: input.language } : {}),
      ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    }),
    ...(input.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(input.timeoutMs) }),
  });
  if (!response.ok) {
    throw new OpenRouterTranscriptionHttpError(response.status);
  }
  const json: unknown = await response.json();
  const text =
    json && typeof json === 'object' && 'text' in json && typeof json.text === 'string'
      ? json.text
      : null;
  if (text === null) throw new Error('OpenRouter transcription response did not include text');
  const usage =
    json &&
    typeof json === 'object' &&
    'usage' in json &&
    json.usage &&
    typeof json.usage === 'object' &&
    !Array.isArray(json.usage)
      ? (json.usage as Record<string, unknown>)
      : null;
  const costUsd = finiteNonNegative(usage?.cost);
  const generationId = response.headers.get('x-generation-id');
  return {
    value: {
      text,
      model: opts.modelId,
      ...(generationId ? { generationId } : {}),
      ...(costUsd === undefined ? {} : { costUsd }),
    },
    finish: openRouterFinishFromAiResult({
      usage,
      providerMetadata: json,
      totalUsage: undefined,
    }),
  };
}

/**
 * Transcribe audio via OpenRouter's OpenAI-compatible
 * `/audio/transcriptions` endpoint. Pinned in `TIMELINE_MODELS`;
 * the result includes the model name so callers can persist it for future
 * re-transcription audits.
 *
 * OpenRouter's STT endpoint expects JSON with base64 audio rather than the
 * OpenAI multipart transcription shape. Tests can still inject `deps.model`
 * for deterministic SDK-level wrapper coverage.
 */
export async function transcribeAudio(
  input: TranscribeInput,
  deps: TranscribeDeps = {},
): Promise<TranscribeResult> {
  const modelId = resolveModelId(input.modelId);
  return wrapAiFailure({ operation: 'llm.transcribeAudio', model: modelId }, async () => {
    return withAiMetering(
      {
        operationClass: 'transcription',
        model: modelId,
        stage: 'transcription',
        callMaterial: [
          modelId,
          input.format ?? '',
          input.language ?? '',
          digestAiBytes(input.audio),
        ],
        ...(input.operationId ? { operationId: input.operationId } : {}),
      },
      async () => {
        if (!deps.model) {
          return transcribeWithOpenRouterJson(input, {
            modelId,
            fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
            ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
            ...(deps.baseURL ? { baseURL: deps.baseURL } : {}),
          });
        }
        const model = deps.model;
        const result = await tracedTranscribe(
          {
            model,
            audio: input.audio,
            ...(input.language
              ? { providerOptions: { openai: { language: input.language } } }
              : {}),
          },
          {
            name: 'llm.transcribeAudio',
            model: modelId,
            metadata: {
              operation: 'transcribe_audio',
              audio_bytes: input.audio.byteLength,
              language_hint: Boolean(input.language),
            },
          },
        );
        return {
          value: { text: result.text, model: modelId },
          finish: openRouterFinishFromAiResult({
            usage: undefined,
            providerMetadata: result.providerMetadata,
            totalUsage: undefined,
          }),
        };
      },
    );
  });
}
