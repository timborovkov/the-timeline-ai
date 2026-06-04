import * as ai from 'ai';
import {
  createLangSmithProviderOptions,
  wrapAISDK,
  type WrapAISDKConfig,
} from 'langsmith/experimental/vercel';
import { traceable } from 'langsmith/traceable';

import { getEnv } from '#src/env.js';

type JsonMetadata = Record<string, string | number | boolean | null | undefined>;
type ProviderOptions = NonNullable<Parameters<typeof ai.generateText>[0]['providerOptions']>;
type LangSmithConfig = Pick<
  WrapAISDKConfig,
  | 'name'
  | 'project_name'
  | 'tracingEnabled'
  | 'tags'
  | 'metadata'
  | 'processInputs'
  | 'processOutputs'
  | 'processChildLLMRunInputs'
  | 'processChildLLMRunOutputs'
>;
type TranscribeParams = Parameters<typeof ai.experimental_transcribe>[0];

export interface LangSmithRunOptions {
  name: string;
  model: string;
  metadata?: JsonMetadata;
  tags?: string[];
  processInputs?: WrapAISDKConfig['processInputs'];
  processOutputs?: WrapAISDKConfig['processOutputs'];
  processChildLLMRunInputs?: WrapAISDKConfig['processChildLLMRunInputs'];
  processChildLLMRunOutputs?: WrapAISDKConfig['processChildLLMRunOutputs'];
}

const tracedAi = wrapAISDK(ai);

export const generateText = tracedAi.generateText;
// generateObject remains the repo's structured-output primitive until the
// AI SDK v6 output replacement is stable enough for extraction.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export const generateObject = tracedAi.generateObject;
export const streamText = tracedAi.streamText;

function langSmithConfig({ name, model, metadata, tags }: LangSmithRunOptions): LangSmithConfig {
  const env = getEnv();
  const config: LangSmithConfig = {
    name,
    project_name: env.LANGSMITH_PROJECT,
    tracingEnabled: env.LANGSMITH_TRACING,
    metadata: {
      ls_provider: 'openrouter',
      ls_model_name: model,
      ...metadata,
    },
  };
  if (tags) config.tags = tags;
  return config;
}

function langSmithAiSdkConfig(options: LangSmithRunOptions): LangSmithConfig {
  const config = langSmithConfig(options);
  if (options.processInputs) config.processInputs = options.processInputs;
  if (options.processOutputs) config.processOutputs = options.processOutputs;
  if (options.processChildLLMRunInputs)
    config.processChildLLMRunInputs = options.processChildLLMRunInputs;
  if (options.processChildLLMRunOutputs)
    config.processChildLLMRunOutputs = options.processChildLLMRunOutputs;
  return config;
}

function langSmithTraceableConfig({ name, model, metadata, tags }: LangSmithRunOptions): {
  name: string;
  project_name: string;
  tracingEnabled: boolean;
  metadata: JsonMetadata;
  tags?: string[];
} {
  const env = getEnv();
  const config = {
    name,
    project_name: env.LANGSMITH_PROJECT,
    tracingEnabled: env.LANGSMITH_TRACING,
    metadata: {
      ls_provider: 'openrouter',
      ls_model_name: model,
      ...metadata,
    },
  };
  return tags ? { ...config, tags } : config;
}

export function withLangSmithProviderOptions(
  providerOptions: ProviderOptions | undefined,
  options: LangSmithRunOptions,
): ProviderOptions {
  return {
    ...providerOptions,
    langsmith: createLangSmithProviderOptions(langSmithAiSdkConfig(options)),
  };
}

function binaryKind(value: unknown): string {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return 'buffer';
  if (value instanceof Uint8Array) return 'uint8_array';
  if (value instanceof ArrayBuffer) return 'array_buffer';
  if (typeof Blob !== 'undefined' && value instanceof Blob) return 'blob';
  if (value instanceof URL) return 'url';
  if (typeof value === 'string') return 'string';
  return value === null ? 'null' : typeof value;
}

function binarySize(value: unknown): number | undefined {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  if (typeof value === 'string') return value.length;
  return undefined;
}

function summarizeBinary(value: unknown): Record<string, unknown> {
  return {
    redacted: true,
    kind: binaryKind(value),
    bytes: binarySize(value),
  };
}

function sanitizeContentPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part;
  const record = part as Record<string, unknown>;
  if (record.type === 'file') {
    return {
      type: 'file',
      mediaType: record.mediaType,
      filename: record.filename,
      data: summarizeBinary(record.data),
    };
  }
  if (record.type === 'image') {
    return {
      type: 'image',
      mediaType: record.mediaType,
      image: summarizeBinary(record.image),
    };
  }
  return part;
}

function sanitizeMessageContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((part) => sanitizeContentPart(part));
}

function sanitizeMessage(message: unknown): unknown {
  if (!message || typeof message !== 'object') return message;
  const record = message as Record<string, unknown>;
  return {
    ...record,
    content: sanitizeMessageContent(record.content),
  };
}

export function sanitizeAiSdkInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return {
    ...inputs,
    messages: Array.isArray(inputs.messages)
      ? inputs.messages.map(sanitizeMessage)
      : inputs.messages,
    prompt: Array.isArray(inputs.prompt) ? inputs.prompt.map(sanitizeMessage) : inputs.prompt,
  };
}

export function sanitizeTranscribeInputs(
  inputs: Readonly<TranscribeParams>,
): Record<string, unknown> {
  const providerOptions = inputs.providerOptions as { openai?: unknown } | undefined;
  const openai =
    providerOptions?.openai && typeof providerOptions.openai === 'object'
      ? (providerOptions.openai as Record<string, unknown>)
      : undefined;

  return {
    audio: summarizeBinary(inputs.audio),
    providerOptions: openai?.language ? { openai: { language: openai.language } } : undefined,
    maxRetries: inputs.maxRetries,
  };
}

function sanitizeTranscribeOutputs(outputs: { text?: unknown }): Record<string, unknown> {
  return { text: outputs.text };
}

export async function experimental_transcribe(
  params: Parameters<typeof ai.experimental_transcribe>[0],
  options: LangSmithRunOptions,
): ReturnType<typeof ai.experimental_transcribe> {
  const base = langSmithTraceableConfig(options);
  const traced = traceable(ai.experimental_transcribe, {
    ...base,
    run_type: 'llm',
    processInputs: sanitizeTranscribeInputs,
    processOutputs: sanitizeTranscribeOutputs,
  });
  return traced(params);
}
