import { chatStructured as defaultChatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  TIMELINE_MOMENT_PRESENTATION_PROMPT_VERSION,
  buildTimelineMomentPresentationCacheKey,
  timelineMomentPresentationEligibility,
  buildTimelineMomentPresentationPrompt,
  timelineMomentPresentationSuggestionSchema,
  isWeakGeneratedTitle,
  type TimelineMomentPresentationResult,
} from '#src/timeline-moments/presentation-contract.js';

import type { TimelineMoment } from '#src/timeline-moments/index.js';

export * from '#src/timeline-moments/presentation-contract.js';

export interface GenerateTimelineMomentPresentationOptions {
  teamId: string;
  model?: string | undefined;
  promptVersion?: string | undefined;
  chatStructured?: typeof defaultChatStructured | undefined;
}

export async function generateTimelineMomentPresentation(
  moment: TimelineMoment,
  options: GenerateTimelineMomentPresentationOptions,
): Promise<TimelineMomentPresentationResult> {
  const model = options.model ?? TIMELINE_MODELS.summarization.id;
  const promptVersion = options.promptVersion ?? TIMELINE_MOMENT_PRESENTATION_PROMPT_VERSION;
  const cacheKey = buildTimelineMomentPresentationCacheKey({
    teamId: options.teamId,
    moment,
    model,
    promptVersion,
  });
  const eligibility = timelineMomentPresentationEligibility(moment);
  if (!eligibility.eligible) {
    return { status: 'skipped', reason: 'not_eligible', cacheKey };
  }
  const prompt = buildTimelineMomentPresentationPrompt(moment, { model, promptVersion });
  const chatStructured = options.chatStructured ?? defaultChatStructured;
  const result = await chatStructured({
    schema: timelineMomentPresentationSuggestionSchema,
    instructions: prompt.instructions,
    prompt: prompt.prompt,
    model,
  });
  if (isWeakGeneratedTitle(result.object.title)) {
    return { status: 'skipped', reason: 'weak_generated_title', cacheKey };
  }
  const sourceEventIds = new Set(moment.rawEvents.map((event) => event.id));
  const suggestion = {
    ...result.object,
    previewEventIds: result.object.previewEventIds.filter((id) => sourceEventIds.has(id)),
  };
  if (suggestion.previewEventIds.length === 0) {
    return { status: 'skipped', reason: 'missing_preview_event_ids', cacheKey };
  }
  return {
    status: 'generated',
    suggestion,
    model: result.model,
    promptVersion,
    cacheKey,
  };
}
