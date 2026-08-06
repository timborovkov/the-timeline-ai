export type ModelCapability =
  | 'chat'
  | 'structured'
  | 'tools'
  | 'vision'
  | 'file'
  | 'audio'
  | 'video'
  | 'embedding'
  | 'transcription';

export interface TimelineModelConfig {
  id: string;
  provider: 'openrouter';
  contextWindowTokens?: number;
  embeddingDimensions?: number;
  capabilities: readonly ModelCapability[];
}

export const TIMELINE_MODELS = {
  extraction: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  structuredFallback: {
    id: 'deepseek/deepseek-v4-pro',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  agent: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  summarization: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  taskCategorization: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured'],
  },
  vision: {
    id: 'google/gemini-3.5-flash',
    provider: 'openrouter',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools', 'vision', 'file', 'audio', 'video'],
  },
  embedding: {
    id: 'openai/text-embedding-3-small',
    provider: 'openrouter',
    contextWindowTokens: 8_192,
    embeddingDimensions: 1536,
    capabilities: ['embedding'],
  },
  transcription: {
    id: 'openai/gpt-4o-transcribe',
    provider: 'openrouter',
    capabilities: ['transcription'],
  },
} as const satisfies Record<string, TimelineModelConfig>;

export const DEFAULT_CHAT_MEMORY = {
  triggerFraction: 0.8,
  keepFraction: 0.3,
  maxRequestMessages: 500,
  summaryMaxOutputTokens: 1200,
} as const;

export const DEFAULT_LLM_CONTEXT = {
  maxInputFraction: 0.8,
  reservedOutputTokens: 4_000,
} as const;

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function inputTokenBudgetFor(
  model: Pick<TimelineModelConfig, 'contextWindowTokens'>,
  opts: {
    fraction?: number;
    reservedOutputTokens?: number;
  } = {},
): number {
  const contextWindow = model.contextWindowTokens ?? 128_000;
  const fraction = opts.fraction ?? DEFAULT_LLM_CONTEXT.maxInputFraction;
  const reservedOutputTokens =
    opts.reservedOutputTokens ?? DEFAULT_LLM_CONTEXT.reservedOutputTokens;
  return Math.max(1, Math.floor(contextWindow * fraction) - reservedOutputTokens);
}

export function truncateTextToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTextTokens(text) <= maxTokens) return text;
  const maxChars = Math.max(1, maxTokens * 4);
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}
