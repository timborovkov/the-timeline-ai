import { getEnv } from '#src/env.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import {
  buildTaskCategoryPacket,
  classifyTaskCategories,
  classifyTaskCategory,
  taskCategoryInputHash,
  type TaskCategoryBatchItem,
  type TaskCategoryBatchPrediction,
  type TaskCategoryPacket,
} from '#src/task-categories/classifier.js';
import { TASK_CATEGORY_TAXONOMY_VERSION, type TaskCategory } from '#src/task-categories/types.js';

export type TaskProposalClassifier = (
  packet: TaskCategoryPacket,
) => Promise<{ category: TaskCategory; confidence: number; model: string }>;

export type TaskProposalBatchClassifier = (
  items: readonly TaskCategoryBatchItem[],
) => Promise<readonly TaskCategoryBatchPrediction[]>;

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function enrichTaskProposalCategory(input: {
  proposedPayload: Record<string, unknown>;
  fallbackTitle: string;
  classify?: TaskProposalClassifier;
  enabled?: boolean;
}): Promise<Record<string, unknown>> {
  const payload = { ...input.proposedPayload };
  if (!(input.enabled ?? getEnv().TASK_CATEGORY_CLASSIFICATION_ENABLED)) return payload;
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

export async function enrichTaskProposalCategories(input: {
  proposals: readonly {
    key: string;
    proposedPayload: Record<string, unknown>;
    fallbackTitle: string;
  }[];
  classify?: TaskProposalBatchClassifier;
  enabled?: boolean;
}): Promise<Map<string, Record<string, unknown>>> {
  const payloads = new Map(
    input.proposals.map((proposal) => [proposal.key, { ...proposal.proposedPayload }]),
  );
  if (!(input.enabled ?? getEnv().TASK_CATEGORY_CLASSIFICATION_ENABLED)) return payloads;
  const items = input.proposals.map((proposal) => {
    const payload = payloads.get(proposal.key) ?? {};
    return {
      key: proposal.key,
      packet: buildTaskCategoryPacket({
        title:
          typeof payload.canonicalName === 'string'
            ? payload.canonicalName
            : proposal.fallbackTitle,
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
      }),
    };
  });
  try {
    const predictions = await (input.classify ?? classifyTaskCategories)(items);
    const predictionByKey = new Map(predictions.map((prediction) => [prediction.key, prediction]));
    for (const item of items) {
      const prediction = predictionByKey.get(item.key);
      const payload = payloads.get(item.key);
      if (!prediction || !payload) continue;
      payloads.set(item.key, {
        ...payload,
        taskCategory: prediction.category,
        taskCategoryConfidence: prediction.confidence,
        taskCategoryModel: prediction.model,
        taskCategoryMode: 'automatic',
        taskCategoryInputHash: taskCategoryInputHash(
          item.packet,
          TIMELINE_MODELS.taskCategorization.id,
        ),
        taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
      });
    }
    return payloads;
  } catch {
    return payloads;
  }
}
