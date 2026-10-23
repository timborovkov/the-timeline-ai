import {
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  type TaskCategory,
} from '#src/task-categories/types.js';

const CATEGORY_SET = new Set<string>(TASK_CATEGORIES);

const CATEGORY_BY_LABEL = new Map<string, TaskCategory>(
  TASK_CATEGORIES.map((category) => [labelKey(TASK_CATEGORY_LABELS[category]), category]),
);

function labelKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceTaskCategory(value: unknown): TaskCategory | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (CATEGORY_SET.has(trimmed)) return trimmed as TaskCategory;
  const slug = trimmed
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (CATEGORY_SET.has(slug)) return slug as TaskCategory;
  return CATEGORY_BY_LABEL.get(labelKey(trimmed)) ?? null;
}

function coerceConfidence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizePrediction(value: unknown, fallbackKey?: string): Record<string, unknown> | null {
  const row = record(value);
  if (!row) return null;
  const category = coerceTaskCategory(row.category ?? row.label ?? row.taskCategory);
  const confidence = coerceConfidence(row.confidence ?? row.score);
  const key = typeof row.key === 'string' && row.key.trim() ? row.key.trim() : fallbackKey;
  if (!category || confidence === null || !key) return null;
  return { key, category, confidence };
}

function normalizeSingle(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  if (!row || 'predictions' in row) return null;
  const category = coerceTaskCategory(row.category ?? row.label ?? row.taskCategory);
  const confidence = coerceConfidence(row.confidence ?? row.score);
  if (!category || confidence === null) return null;
  return { category, confidence };
}

function predictionsFromValue(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    const predictions = value.flatMap((item) => {
      const prediction = normalizePrediction(item);
      return prediction ? [prediction] : [];
    });
    return predictions.length === value.length && predictions.length > 0 ? predictions : null;
  }
  const row = record(value);
  if (!row) return null;
  const predictions = Object.entries(row).flatMap(([key, item]) => {
    const prediction = normalizePrediction(item, key);
    return prediction ? [prediction] : [];
  });
  return predictions.length === Object.keys(row).length && predictions.length > 0
    ? predictions
    : null;
}

function unwrapCategoryPayload(value: unknown): unknown {
  const row = record(value);
  if (!row) return value;
  const nested = row.result ?? row.output ?? row.data ?? row.object ?? row.response;
  return nested ?? value;
}

/**
 * Recover task-category JSON that a model wrapped, labeled, or stringified.
 * Returns the original value when the payload is not a category result.
 */
export function normalizeTaskCategoryModelJson(value: unknown): unknown {
  const unwrapped = unwrapCategoryPayload(value);
  const single = normalizeSingle(unwrapped) ?? normalizeSingle(value);
  if (single) return single;

  const row = record(unwrapped) ?? record(value);
  const batchSource = row?.predictions ?? unwrapped;
  const predictions = predictionsFromValue(batchSource);
  if (!predictions) return value;
  return { predictions };
}
