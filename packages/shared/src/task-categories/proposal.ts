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
import {
  TASK_CATEGORY_TAXONOMY_VERSION,
  taskCategorySchema,
  type TaskCategory,
} from '#src/task-categories/types.js';

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

function stampTaskProposal(
  payload: Record<string, unknown>,
  prediction: { category: string; confidence: number; model: string },
  packet: TaskCategoryPacket,
): Record<string, unknown> {
  const category = taskCategorySchema.safeParse(prediction.category);
  const model = prediction.model.trim();
  if (
    !category.success ||
    !Number.isFinite(prediction.confidence) ||
    prediction.confidence < 0 ||
    prediction.confidence > 1 ||
    !model
  ) {
    throw new Error('Task category classification returned an unusable prediction');
  }
  return {
    ...payload,
    taskCategory: category.data,
    taskCategoryConfidence: prediction.confidence,
    taskCategoryModel: model,
    taskCategoryMode: 'automatic' as const,
    taskCategoryInputHash: taskCategoryInputHash(packet, TIMELINE_MODELS.taskCategorization.id),
    taskCategoryTaxonomyVersion: TASK_CATEGORY_TAXONOMY_VERSION,
  };
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
  const prediction = await (input.classify ?? classifyTaskCategory)(packet);
  return stampTaskProposal(payload, prediction, packet);
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
  const predictions = await (input.classify ?? classifyTaskCategories)(items);
  const predictionByKey = new Map<string, (typeof predictions)[number]>();
  for (const prediction of predictions) {
    if (predictionByKey.has(prediction.key)) {
      throw new Error('Task category classification returned a duplicate proposal key');
    }
    predictionByKey.set(prediction.key, prediction);
  }
  for (const item of items) {
    const prediction = predictionByKey.get(item.key);
    const payload = payloads.get(item.key);
    if (!prediction || !payload) {
      throw new Error('Task category classification omitted a task proposal');
    }
    payloads.set(item.key, stampTaskProposal(payload, prediction, item.packet));
  }
  return payloads;
}
