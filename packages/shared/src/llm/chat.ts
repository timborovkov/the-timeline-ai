import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  generateObject,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { type z } from 'zod';

import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';

export interface ChatStructuredInput<TSchema extends z.ZodType> {
  schema: TSchema;
  prompt: string;
  system?: string;
  /** Override the configured extraction model for this call. */
  model?: string;
}

export interface ChatDeps {
  /** Inject a pre-built LanguageModel — used by tests with MockLanguageModelV2. */
  model?: LanguageModel;
  /** Inject fetch for provider-boundary tests. */
  fetch?: typeof globalThis.fetch;
}

export interface ChatStructuredResult<TSchema extends z.ZodType> {
  object: z.infer<TSchema>;
  /** Identifier of the model that produced the response — persisted for audits. */
  model: string;
}

function resolveDefaultModelId(): string {
  return TIMELINE_MODELS.extraction.id;
}

function resolveAgentModelId(): string {
  return TIMELINE_MODELS.agent.id;
}

function structuredOutputSystem(system?: string): string {
  const jsonInstruction = 'Return JSON that matches the requested schema.';
  if (!system) return jsonInstruction;
  return system.toLowerCase().includes('json') ? system : `${system}\n\n${jsonInstruction}`;
}

export function buildOpenRouterLanguageModel(
  modelId: string,
  deps: Pick<ChatDeps, 'fetch'> = {},
): LanguageModel {
  const env = getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for llm.chat');
  }
  const baseURL = env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = createOpenAICompatible({
    name: 'openrouter',
    apiKey: env.OPENROUTER_API_KEY,
    baseURL,
    supportsStructuredOutputs: true,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
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
export async function chatStructured<TSchema extends z.ZodType>(
  input: ChatStructuredInput<TSchema>,
  deps: ChatDeps = {},
): Promise<ChatStructuredResult<TSchema>> {
  const modelId = input.model ?? resolveDefaultModelId();
  const model = deps.model ?? buildOpenRouterLanguageModel(modelId, deps);
  // generateObject is the right primitive for structured-output extraction;
  // the "use generateText with output" deprecation guidance applies to chat
  // surfaces where streaming matters. Revisit once ai v6 stabilises.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const result = await generateObject({
    model,
    schema: input.schema,
    prompt: input.prompt,
    system: structuredOutputSystem(input.system),
  });
  return { object: result.object as z.infer<TSchema>, model: modelId };
}

export interface StreamChatInput<TTools extends ToolSet> {
  system: string;
  messages: ModelMessage[];
  tools: TTools;
  /** Override the configured agent model for this call. */
  model?: string;
  /** Hard cap on tool-call rounds. Default 5; matches the brief's
   *  "agents can loop — cap turn count and bail gracefully" guidance. */
  maxSteps?: number;
  /** Forwarded to streamText.onFinish for usage/audit logging. */
  onFinish?: Parameters<typeof streamText>[0]['onFinish'];
  /**
   * AbortSignal wired to the request lifecycle. The AI SDK propagates it to
   * the underlying OpenRouter fetch, so a client disconnect stops billing
   * for tokens we'll never deliver. Pass `req.signal` from Next.js route
   * handlers.
   */
  abortSignal?: AbortSignal;
}

/**
 * Streaming, tool-using chat against OpenRouter (OpenAI-compatible). Mirrors
 * `chatStructured`'s env-gating, model-pinning, deps-injectable shape, but
 * returns a `StreamTextResult` so the caller can pipe it into a Response.
 *
 * Tests inject `deps.model` (typically a MockLanguageModelV3 with a `doStream`
 * implementation). When unset, the function builds a provider from env
 * (`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`). Use this for `/api/chat` —
 * tool calls happen between streamed text chunks and the UI shows progress
 * for each one.
 */
export function streamChat<TTools extends ToolSet>(
  input: StreamChatInput<TTools>,
  deps: ChatDeps = {},
): StreamTextResult<TTools, never> {
  const modelId = input.model ?? resolveAgentModelId();
  const model = deps.model ?? buildOpenRouterLanguageModel(modelId, deps);
  const args: Parameters<typeof streamText>[0] = {
    model,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 5),
  };
  if (input.onFinish) args.onFinish = input.onFinish;
  if (input.abortSignal) args.abortSignal = input.abortSignal;
  return streamText(args) as unknown as StreamTextResult<TTools, never>;
}

export { resolveAgentModelId };
