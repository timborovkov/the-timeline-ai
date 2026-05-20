import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, type LanguageModel } from 'ai';
import { type z, type ZodTypeAny } from 'zod';

import { getEnv } from '../env';

export interface ChatStructuredInput<TSchema extends ZodTypeAny> {
  schema: TSchema;
  prompt: string;
  system?: string;
  /** Override the configured extraction/chat model for this call. */
  model?: string;
}

export interface ChatDeps {
  /** Inject a pre-built LanguageModel — used by tests with MockLanguageModelV2. */
  model?: LanguageModel;
}

export interface ChatStructuredResult<TSchema extends ZodTypeAny> {
  object: z.infer<TSchema>;
  /** Identifier of the model that produced the response — persisted for audits. */
  model: string;
}

function resolveDefaultModelId(): string {
  const env = getEnv();
  return env.EXTRACTION_MODEL ?? env.CHAT_MODEL_DEFAULT ?? 'openai/gpt-4o-mini';
}

function buildDefaultModel(modelId: string): LanguageModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for llm.chat');
  }
  const baseURL = env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
  });
  return provider(modelId);
}

/**
 * Structured-output chat against OpenRouter (OpenAI-compatible). Returns the
 * parsed object plus the model id that produced it; the model id is persisted
 * with each extracted fact so re-extraction is versioned and auditable.
 *
 * Tests inject `deps.model` (typically a MockLanguageModelV2). When unset, the
 * function builds a provider from env (`OPENROUTER_API_KEY`,
 * `OPENROUTER_BASE_URL`).
 */
export async function chatStructured<TSchema extends ZodTypeAny>(
  input: ChatStructuredInput<TSchema>,
  deps: ChatDeps = {},
): Promise<ChatStructuredResult<TSchema>> {
  const modelId = input.model ?? resolveDefaultModelId();
  const model = deps.model ?? buildDefaultModel(modelId);
  // generateObject is the right primitive for structured-output extraction;
  // the "use generateText with output" deprecation guidance applies to chat
  // surfaces where streaming matters. Revisit once ai v6 stabilises.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const result = await generateObject({
    model,
    schema: input.schema,
    prompt: input.prompt,
    ...(input.system ? { system: input.system } : {}),
  });
  return { object: result.object, model: modelId };
}
