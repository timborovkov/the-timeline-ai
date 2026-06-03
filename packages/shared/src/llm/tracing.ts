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
  'name' | 'project_name' | 'tracingEnabled' | 'tags' | 'metadata'
>;

export interface LangSmithRunOptions {
  name: string;
  model: string;
  metadata?: JsonMetadata;
  tags?: string[];
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

export function withLangSmithProviderOptions(
  providerOptions: ProviderOptions | undefined,
  options: LangSmithRunOptions,
): ProviderOptions {
  return {
    ...providerOptions,
    langsmith: createLangSmithProviderOptions(langSmithConfig(options)),
  };
}

export async function embed(
  params: Parameters<typeof ai.embed>[0],
  options: LangSmithRunOptions,
): ReturnType<typeof ai.embed> {
  const traced = traceable(ai.embed, {
    ...langSmithConfig(options),
    run_type: 'llm',
  });
  return traced(params);
}

export async function experimental_transcribe(
  params: Parameters<typeof ai.experimental_transcribe>[0],
  options: LangSmithRunOptions,
): ReturnType<typeof ai.experimental_transcribe> {
  const traced = traceable(ai.experimental_transcribe, {
    ...langSmithConfig(options),
    run_type: 'llm',
  });
  return traced(params);
}
