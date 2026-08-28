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

export type ModelPrivacyMode = 'zdr_required' | 'retained_no_training_exception';

export interface RetainedNoTrainingDisclosureSource {
  label: string;
  href: string;
  statement: string;
}

export interface RetainedNoTrainingDisclosure {
  openRouter: RetainedNoTrainingDisclosureSource;
  upstream: RetainedNoTrainingDisclosureSource;
}

/**
 * Bump whenever the hosted OpenRouter model/privacy contract changes. The
 * production environment attests to this exact version after the key and
 * account settings have been reviewed.
 */
export const TIMELINE_AI_PRIVACY_POLICY_VERSION = '2026-08-21.1' as const;

export interface TimelineModelConfig {
  id: string;
  provider: 'openrouter';
  privacyMode: ModelPrivacyMode;
  retainedNoTrainingDisclosure?: RetainedNoTrainingDisclosure;
  contextWindowTokens?: number;
  embeddingDimensions?: number;
  capabilities: readonly ModelCapability[];
}

export const TIMELINE_MODELS = {
  extraction: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  structuredFallback: {
    id: 'deepseek/deepseek-v4-pro',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  agent: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  summarization: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools'],
  },
  taskCategorization: {
    id: 'deepseek/deepseek-v4-flash-0731',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured'],
  },
  vision: {
    id: 'google/gemini-3.5-flash',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 1_048_576,
    capabilities: ['chat', 'structured', 'tools', 'vision', 'file', 'audio', 'video'],
  },
  embedding: {
    id: 'openai/text-embedding-3-small',
    provider: 'openrouter',
    privacyMode: 'zdr_required',
    contextWindowTokens: 8_192,
    embeddingDimensions: 1536,
    capabilities: ['embedding'],
  },
  transcription: {
    id: 'openai/gpt-4o-transcribe',
    provider: 'openrouter',
    privacyMode: 'retained_no_training_exception',
    retainedNoTrainingDisclosure: {
      openRouter: {
        label: "OpenRouter's provider table",
        href: 'https://openrouter.ai/providers',
        statement: 'lists OpenAI as not training on prompts but retaining them',
      },
      upstream: {
        label: 'OpenAI API data controls',
        href: 'https://platform.openai.com/docs/models/default-usage-policies-by-endpoint',
        statement:
          'document default API abuse-monitoring retention of inputs and outputs for up to 30 days',
      },
    },
    capabilities: ['transcription'],
  },
} as const satisfies Record<string, TimelineModelConfig>;

export type TimelineModelRole = keyof typeof TIMELINE_MODELS;

export function timelineModelEntries(): readonly [TimelineModelRole, TimelineModelConfig][] {
  return Object.entries(TIMELINE_MODELS) as [TimelineModelRole, TimelineModelConfig][];
}

export function uniqueTimelineModelsByPrivacyMode(
  privacyMode: ModelPrivacyMode,
): readonly TimelineModelConfig[] {
  const models = new Map<string, TimelineModelConfig>();
  for (const [, model] of timelineModelEntries()) {
    if (model.privacyMode === privacyMode) models.set(model.id, model);
  }
  return [...models.values()];
}

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
