import { type TranscriptionModel } from 'ai';

import { openRouterFinishFromAiResult } from '#src/billing/openrouter-usage.js';
import { withAiMetering } from '#src/billing/runtime.js';
import { getEnv } from '#src/env.js';
import { wrapAiFailure } from '#src/llm/errors.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { experimental_transcribe as tracedTranscribe } from '#src/llm/tracing.js';

export interface TranscribeInput {
  /** Raw audio bytes. OpenRouter STT accepts JSON with base64 audio data and a format hint. */
  audio: Buffer;
  format?: AudioFormat;
  /** ISO-639-1 language hint (e.g. 'fi', 'en', 'de'). Improves accuracy
   *  for non-English audio. Omit for auto-detection. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

export interface TranscribeDeps {
  /**
   * Inject a pre-built TranscriptionModel for tests. Same shape as
   * chat.ts/embed.ts so the three LLM ops have a consistent test pattern.
   */
  model?: TranscriptionModel;
  fetch?: typeof globalThis.fetch;
}

export type AudioFormat = 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg' | 'webm' | 'aac';

function resolveModelId(): string {
  return TIMELINE_MODELS.transcription.id;
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
  opts: { modelId: string; fetch: typeof globalThis.fetch },
): Promise<TranscribeResult> {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for transcription');
  }
  const baseURL = (env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/u, '');
  const response = await opts.fetch(`${baseURL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.modelId,
      input_audio: {
        data: input.audio.toString('base64'),
        format: input.format ?? inferAudioFormat(input.audio),
      },
      ...(input.language ? { language: input.language } : {}),
    }),
  });
  if (!response.ok) {
    const details = (await response.text().catch(() => '')).trim().slice(0, 500);
    throw new Error(
      `OpenRouter transcription failed with ${response.status}${details ? `: ${details}` : ''}`,
    );
  }
  const json: unknown = await response.json();
  const text =
    json && typeof json === 'object' && 'text' in json && typeof json.text === 'string'
      ? json.text
      : null;
  if (text === null) throw new Error('OpenRouter transcription response did not include text');
  return { text, model: opts.modelId };
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
  const modelId = resolveModelId();
  return wrapAiFailure({ operation: 'llm.transcribeAudio', model: modelId }, async () => {
    return withAiMetering({ operationClass: 'transcription', model: modelId }, async () => {
      if (!deps.model) {
        const value = await transcribeWithOpenRouterJson(input, {
          modelId,
          fetch: deps.fetch ?? globalThis.fetch.bind(globalThis),
        });
        return { value };
      }
      const model = deps.model;
      const result = await tracedTranscribe(
        {
          model,
          audio: input.audio,
          ...(input.language ? { providerOptions: { openai: { language: input.language } } } : {}),
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
          providerMetadata: result.providerMetadata,
        }),
      };
    });
  });
}
