import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  NoObjectGeneratedError,
  stepCountIs,
  type RepairTextFunction,
  type LanguageModel,
  type ModelMessage,
  type StreamTextOnFinishCallback,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

import { getEnv } from '#src/env.js';
import {
  TimelineAiError,
  toTimelineAiError,
  wrapAiFailure,
  type TimelineAiErrorMetadata,
} from '#src/llm/errors.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  generateObject,
  generateText,
  streamText,
  withLangSmithProviderOptions,
} from '#src/llm/tracing.js';

type GenerateObjectProviderOptions = NonNullable<
  Parameters<typeof generateObject>[0]['providerOptions']
>;

export const DEFAULT_AGENT_MAX_STEPS = 20;
export const DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS = 32_768;

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

type StreamFinishEvent = Parameters<StreamTextOnFinishCallback<ToolSet>>[0];

export interface StreamChatModelAttribution {
  requestedModelId: string;
  responseModelId: string;
  fallbackModelIds: string[];
}

class JsonObjectFallbackParseError extends Error {
  constructor(cause: unknown) {
    super('llm.chatStructured json_object fallback returned invalid JSON', { cause });
    this.name = 'JsonObjectFallbackParseError';
  }
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

function structuredOutputFallbackSystem(schema: z.ZodType, system?: string): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  return `${structuredOutputSystem(system)}

Return only a JSON object matching this JSON Schema:
${jsonSchema}`;
}

function openRouterRequireParametersOptions(): GenerateObjectProviderOptions {
  return {
    openrouter: {
      provider: {
        require_parameters: true,
      },
    },
  };
}

function openRouterJsonObjectOptions(): GenerateObjectProviderOptions {
  return {
    openrouter: {
      provider: {
        require_parameters: true,
      },
      response_format: { type: 'json_object' },
    },
  };
}

export function streamChatFallbackModelIds(modelId: string): string[] {
  const fallbackModelId = TIMELINE_MODELS.structuredFallback.id;
  return fallbackModelId === modelId ? [] : [fallbackModelId];
}

export function streamChatModelAttribution(
  event: Pick<StreamFinishEvent, 'model' | 'response'>,
  requestedModelId = event.model.modelId,
): StreamChatModelAttribution {
  return {
    requestedModelId,
    responseModelId: event.response.modelId,
    fallbackModelIds: streamChatFallbackModelIds(requestedModelId),
  };
}

function openRouterModelFallbackOptions(
  modelId: string,
): GenerateObjectProviderOptions | undefined {
  const fallbackModelIds = streamChatFallbackModelIds(modelId);
  if (fallbackModelIds.length === 0) return undefined;
  return {
    openrouter: {
      models: [modelId, ...fallbackModelIds],
    },
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof AggregateError) return err.errors.map(errorMessage).join('\n');
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function hasNoObjectGeneratedError(err: unknown): boolean {
  if (NoObjectGeneratedError.isInstance(err)) return true;
  if (err instanceof AggregateError) return err.errors.some(hasNoObjectGeneratedError);
  if (err instanceof Error && 'cause' in err) return hasNoObjectGeneratedError(err.cause);
  return false;
}

function hasSchemaValidationError(err: unknown): boolean {
  if (err instanceof z.ZodError) return true;
  if (err instanceof AggregateError) return err.errors.some(hasSchemaValidationError);
  if (err instanceof Error && 'cause' in err) return hasSchemaValidationError(err.cause);
  return false;
}

function shouldFallbackToJsonObject(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return (
    hasNoObjectGeneratedError(err) ||
    message.includes('json_schema') ||
    message.includes('structured output') ||
    (message.includes('response_format') &&
      (message.includes('not supported') ||
        message.includes('unsupported') ||
        message.includes('rejected')))
  );
}

function statusCodesFromError(err: unknown): number[] {
  if (err instanceof AggregateError) {
    return err.errors.flatMap(statusCodesFromError);
  }
  if (!err || typeof err !== 'object') return [];
  const record = err as Record<string, unknown>;
  const statusCode = record.statusCode ?? record.status ?? record.responseStatus;
  return typeof statusCode === 'number' ? [statusCode] : [];
}

function isRetryableStatusCode(code: number): boolean {
  return code === 408 || code === 429 || code >= 500;
}

function hasRetryableProviderMessage(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('temporarily unavailable') ||
    message.includes('provider unavailable') ||
    message.includes('overloaded') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504')
  );
}

function hasJsonObjectFallbackParseError(err: unknown): boolean {
  if (err instanceof JsonObjectFallbackParseError) return true;
  if (err instanceof AggregateError) return err.errors.some(hasJsonObjectFallbackParseError);
  if (err instanceof Error && 'cause' in err) return hasJsonObjectFallbackParseError(err.cause);
  return false;
}

function shouldFallbackToAlternateModel(err: unknown): boolean {
  const statusCodes = statusCodesFromError(err);
  return (
    hasNoObjectGeneratedError(err) ||
    hasSchemaValidationError(err) ||
    hasJsonObjectFallbackParseError(err) ||
    statusCodes.some(isRetryableStatusCode) ||
    hasRetryableProviderMessage(err)
  );
}

function repairKnownStructuredOutput(schema: z.ZodType): RepairTextFunction {
  return ({ text }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return Promise.resolve(null);
    }
    const candidate = Array.isArray(parsed) ? { facts: parsed } : parsed;
    if (!candidate || typeof candidate !== 'object') return Promise.resolve(null);
    const row = candidate as Record<string, unknown>;
    const facts = Array.isArray(row.facts) ? (row.facts as unknown[]) : null;
    const repaired = {
      ...row,
      ...(facts
        ? {
            facts: facts.map((fact) => {
              if (!fact || typeof fact !== 'object') return fact;
              const factRow = fact as Record<string, unknown>;
              return {
                ...factRow,
                statement: factRow.statement ?? factRow.text,
                mentions: factRow.mentions ?? factRow.entities,
              };
            }),
          }
        : {}),
      action_items: row.action_items ?? row.actionItems,
      choice: row.choice ?? row.candidate_index ?? row.candidateIndex ?? row.index,
    };
    return Promise.resolve(schema.safeParse(repaired).success ? JSON.stringify(repaired) : null);
  };
}

export function buildOpenRouterLanguageModel(
  modelId: string,
  deps: Pick<ChatDeps, 'fetch'> = {},
  options: { supportsStructuredOutputs?: boolean } = {},
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
    supportsStructuredOutputs: options.supportsStructuredOutputs ?? true,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return provider(modelId);
}

async function generateStructuredObject<TSchema extends z.ZodType>({
  schema,
  prompt,
  system,
  model,
  modelId,
  operation,
}: {
  schema: TSchema;
  prompt: string;
  system: string;
  model: LanguageModel;
  modelId: string;
  operation: 'chat_structured' | 'chat_structured_json_object_fallback';
}) {
  // generateObject is the right primitive for structured-output extraction;
  // the "use generateText with output" deprecation guidance applies to chat
  // surfaces where streaming matters. Revisit once ai v6 stabilises.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return generateObject({
    model,
    schema,
    prompt,
    system,
    maxOutputTokens: DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    experimental_repairText: repairKnownStructuredOutput(schema),
    providerOptions: withLangSmithProviderOptions(openRouterRequireParametersOptions(), {
      name: 'llm.chatStructured',
      model: modelId,
      metadata: {
        operation,
      },
    }),
  });
}

async function generateJsonObjectFallback<TSchema extends z.ZodType>({
  schema,
  prompt,
  system,
  model,
  modelId,
}: {
  schema: TSchema;
  prompt: string;
  system: string;
  model: LanguageModel;
  modelId: string;
}) {
  const result = await generateText({
    model,
    prompt,
    system,
    maxOutputTokens: DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    providerOptions: withLangSmithProviderOptions(openRouterJsonObjectOptions(), {
      name: 'llm.chatStructured',
      model: modelId,
      metadata: {
        operation: 'chat_structured_json_object_fallback',
      },
    }),
  });
  const repair = repairKnownStructuredOutput(schema);
  const repaired = await repair({
    text: result.text,
    error: new Error('json_object fallback validation') as never,
  });
  const candidateText = repaired ?? result.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidateText);
  } catch (err) {
    throw new JsonObjectFallbackParseError(err);
  }
  const object: z.infer<TSchema> = schema.parse(parsed);
  return { object };
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
  return wrapAiFailure({ operation: 'llm.chatStructured', model: modelId }, async () => {
    const runModel = async (candidateModelId: string): Promise<ChatStructuredResult<TSchema>> => {
      const model = deps.model ?? buildOpenRouterLanguageModel(candidateModelId, deps);
      try {
        const result = await generateStructuredObject({
          schema: input.schema,
          prompt: input.prompt,
          system: structuredOutputSystem(input.system),
          model,
          modelId: candidateModelId,
          operation: 'chat_structured',
        });
        const object: z.infer<TSchema> = input.schema.parse(result.object);
        return { object, model: candidateModelId };
      } catch (err) {
        if (deps.model || !shouldFallbackToJsonObject(err)) throw err;
        const fallbackModel = buildOpenRouterLanguageModel(candidateModelId, deps, {
          supportsStructuredOutputs: false,
        });
        const result = await generateJsonObjectFallback({
          schema: input.schema,
          prompt: input.prompt,
          system: structuredOutputFallbackSystem(input.schema, input.system),
          model: fallbackModel,
          modelId: candidateModelId,
        }).catch((fallbackErr: unknown) => {
          throw new AggregateError(
            [err, fallbackErr],
            'llm.chatStructured failed with json_schema and json_object response formats',
          );
        });
        return { object: result.object, model: candidateModelId };
      }
    };

    try {
      return await runModel(modelId);
    } catch (err) {
      const fallbackModelId = TIMELINE_MODELS.structuredFallback.id;
      if (deps.model || fallbackModelId === modelId || !shouldFallbackToAlternateModel(err)) {
        throw err;
      }
      return runModel(fallbackModelId).catch((fallbackErr: unknown) => {
        throw new AggregateError(
          [err, fallbackErr],
          'llm.chatStructured failed with primary and fallback structured models',
        );
      });
    }
  });
}

export interface StreamChatInput<TTools extends ToolSet> {
  system: string;
  messages: ModelMessage[];
  tools: TTools;
  /** Override the configured agent model for this call. */
  model?: string;
  /** Hard cap on tool-call rounds. Defaults to `DEFAULT_AGENT_MAX_STEPS`. */
  maxSteps?: number;
  /** Forwarded to streamText.onFinish for usage/audit logging. */
  onFinish?: Parameters<typeof streamText>[0]['onFinish'];
  /** Forwarded to streamText.onError for provider/stream failures. */
  onError?: Parameters<typeof streamText>[0]['onError'];
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
  const metadata = { operation: 'llm.streamChat', model: modelId };
  let model: LanguageModel;
  try {
    model = deps.model ?? buildOpenRouterLanguageModel(modelId, deps);
  } catch (err) {
    throw new TimelineAiError(metadata, err);
  }
  const args: Parameters<typeof streamText>[0] = {
    model,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS),
    providerOptions: withLangSmithProviderOptions(openRouterModelFallbackOptions(modelId), {
      name: 'llm.streamChat',
      model: modelId,
      metadata: {
        operation: 'stream_chat',
        max_steps: input.maxSteps ?? DEFAULT_AGENT_MAX_STEPS,
        requested_model_id: modelId,
        fallback_model_ids: streamChatFallbackModelIds(modelId).join(','),
      },
    }),
  };
  if (input.onFinish) args.onFinish = input.onFinish;
  if (input.onError) {
    args.onError = (event) => {
      input.onError?.({ ...event, error: callbackSafeTimelineAiError(metadata, event.error) });
    };
  }
  if (input.abortSignal) args.abortSignal = input.abortSignal;
  return streamText(args) as unknown as StreamTextResult<TTools, never>;
}

function callbackSafeTimelineAiError(
  metadata: TimelineAiErrorMetadata,
  err: unknown,
): TimelineAiError {
  const wrapped = toTimelineAiError(metadata, err);
  const { cause: _cause, ...withoutCause } = wrapped as TimelineAiError & { cause?: unknown };
  return Object.assign(new Error(wrapped.message), withoutCause, {
    name: wrapped.name,
    stack: wrapped.stack,
  }) as TimelineAiError;
}

export { resolveAgentModelId };
