import { createOpenAI } from '@ai-sdk/openai';
import { type TranscriptionModel } from 'ai';

import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { experimental_transcribe as tracedTranscribe } from '#src/llm/tracing.js';

export interface TranscribeInput {
  /** Raw audio bytes. The SDK builds the multipart upload internally and
   *  Whisper auto-detects the format, so filename/mimeType hints from the
   *  caller are no longer needed (they were used by the previous raw-fetch
   *  implementation). */
  audio: Buffer;
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
}

function resolveModelId(): string {
  // OpenRouter route-style ids are accepted by `createOpenAI({ baseURL:
  // openrouter })` because OpenRouter forwards the multipart body untouched
  // and uses its own model routing.
  return TIMELINE_MODELS.transcription.id;
}

function buildDefaultModel(modelId: string): TranscriptionModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for transcription');
  }
  // The `@ai-sdk/openai` provider speaks the OpenAI wire format, which
  // OpenRouter is compatible with at `/audio/transcriptions`. Pointing
  // baseURL at OpenRouter routes the multipart upload through OpenRouter's
  // model gateway while keeping us on the same SDK surface as chat + embed.
  const provider = createOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  });
  return provider.transcription(modelId);
}

/**
 * Transcribe audio via OpenRouter's OpenAI-compatible
 * `/audio/transcriptions` endpoint. Pinned in `TIMELINE_MODELS`;
 * the result includes the model name so callers can persist it for future
 * re-transcription audits.
 *
 * Uses the Vercel AI SDK's `experimental_transcribe` against an OpenAI
 * provider pointed at OpenRouter. The `@ai-sdk/openai-compatible` provider
 * doesn't expose transcription, only chat + embed, so the OpenAI-branded
 * provider is the simplest way to keep the three LLM ops on one SDK
 * surface. Tests inject `deps.model`; the default builder reads env.
 */
export async function transcribeAudio(
  input: TranscribeInput,
  deps: TranscribeDeps = {},
): Promise<TranscribeResult> {
  const modelId = resolveModelId();
  const model = deps.model ?? buildDefaultModel(modelId);
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
        language_hint: input.language ? true : false,
      },
    },
  );
  return { text: result.text, model: modelId };
}
