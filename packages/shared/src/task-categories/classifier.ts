import { chatStructured } from '#src/llm/chat.js';
import { TIMELINE_MODELS } from '#src/llm/models.js';
import { normalizeTaskCategoryModelJson } from '#src/task-categories/model-output.js';
import {
  TASK_CATEGORY_SYSTEM_PROMPT,
  taskCategoryClassificationSchema,
  taskCategoryBatchClassificationSchema,
  buildTaskCategoryPrompt,
  buildTaskCategoryBatchPrompt,
  type TaskCategoryPacket,
  type TaskCategoryBatchItem,
  type TaskCategoryBatchPrediction,
} from '#src/task-categories/packet.js';

import type { TaskCategory } from '#src/task-categories/types.js';

export * from '#src/task-categories/packet.js';

export async function classifyTaskCategory(
  packet: TaskCategoryPacket,
  deps: {
    chatStructured?: typeof chatStructured;
    modelId?: string;
    abortSignal?: AbortSignal;
  } = {},
): Promise<{ category: TaskCategory; confidence: number; model: string }> {
  const call = deps.chatStructured ?? chatStructured;
  const modelId = deps.modelId ?? TIMELINE_MODELS.taskCategorization.id;
  const result = await call({
    schema: taskCategoryClassificationSchema,
    normalizeOutput: normalizeTaskCategoryModelJson,
    instructions: TASK_CATEGORY_SYSTEM_PROMPT,
    prompt: buildTaskCategoryPrompt(packet),
    model: modelId,
    ...(deps.abortSignal ? { abortSignal: deps.abortSignal } : {}),
  });
  return { ...result.object, model: result.model };
}

export async function classifyTaskCategories(
  items: readonly TaskCategoryBatchItem[],
  deps: {
    chatStructured?: typeof chatStructured;
    modelId?: string;
    abortSignal?: AbortSignal;
  } = {},
): Promise<TaskCategoryBatchPrediction[]> {
  if (items.length === 0) return [];
  if (items.length > 25) throw new Error('Task category batches are limited to 25 tasks');
  const keys = new Set<string>();
  for (const item of items) {
    if (!item.key || item.key.length > 100 || keys.has(item.key)) {
      throw new Error('Task category batch keys must be unique and between 1 and 100 characters');
    }
    keys.add(item.key);
  }
  const call = deps.chatStructured ?? chatStructured;
  const modelId = deps.modelId ?? TIMELINE_MODELS.taskCategorization.id;
  const result = await call({
    schema: taskCategoryBatchClassificationSchema,
    normalizeOutput: normalizeTaskCategoryModelJson,
    instructions: TASK_CATEGORY_SYSTEM_PROMPT,
    prompt: buildTaskCategoryBatchPrompt(items),
    model: modelId,
    ...(deps.abortSignal ? { abortSignal: deps.abortSignal } : {}),
  });
  const seen = new Set<string>();
  const predictions: TaskCategoryBatchPrediction[] = [];
  for (const prediction of result.object.predictions) {
    if (!keys.has(prediction.key)) continue;
    if (seen.has(prediction.key)) {
      throw new Error('Task category classification returned a duplicate proposal key');
    }
    seen.add(prediction.key);
    predictions.push({ ...prediction, model: result.model });
  }
  if (seen.size !== keys.size) {
    throw new Error(
      `Task category classification omitted ${String(keys.size - seen.size)} of ${String(keys.size)} proposals`,
    );
  }
  return predictions;
}
