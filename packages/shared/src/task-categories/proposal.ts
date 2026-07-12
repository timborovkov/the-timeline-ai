import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  buildTaskCategoryPacket,
  classifyTaskCategory,
  taskCategoryInputHash,
  type TaskCategoryPacket,
} from '#src/task-categories/classifier.js';
import { TASK_CATEGORY_TAXONOMY_VERSION, type TaskCategory } from '#src/task-categories/types.js';

export type TaskProposalClassifier = (
  packet: TaskCategoryPacket,
) => Promise<{ category: TaskCategory; confidence: number; model: string }>;

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function enrichTaskProposalCategory(input: {
  proposedPayload: Record<string, unknown>;
  fallbackTitle: string;
  classify?: TaskProposalClassifier;
}): Promise<Record<string, unknown>> {
  const payload = { ...input.proposedPayload };
  const packet = buildTaskCategoryPacket({
    title: typeof payload.canonicalName === 'string' ? payload.canonicalName : input.fallbackTitle,
    aliases: Array.isArray(payload.aliases)
      ? payload.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    metadata: recordFromUnknown(payload.metadata),
    primaryProjectName:
      typeof payload.projectName === 'string'
        ? payload.projectName
        : typeof payload.createProjectName === 'string'
          ? payload.createProjectName
          : null,
  });
  try {
    const prediction = await (input.classify ?? classifyTaskCategory)(packet);
    return {
      ...payload,
      taskCategory: prediction.category,
      taskCategoryConfidence: prediction.confidence,
      taskCategoryModel: prediction.model,
      taskCategoryMode: 'automatic',
      taskCategoryInputHash: taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id),
      taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
    };
  } catch {
    return payload;
  }
}
