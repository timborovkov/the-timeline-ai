'use client';

import { useQueries, type Query } from '@tanstack/react-query';
import { useRef } from 'react';

import { loadTaskCategoryStatesAction } from '@/app/actions/objects';

const SLOW_POLL_INTERVAL_MS = 15_000;
const FAST_POLL_WINDOW_MS = 60_000;
const MAX_POLL_WINDOW_MS = 10 * 60_000;
const TASK_CATEGORY_POLL_CHUNK_SIZE = 200;

interface TaskCategoryPollResult {
  rows: NonNullable<Awaited<ReturnType<typeof loadTaskCategoryStatesAction>>['rows']>;
}

export function taskCategoryPollInterval(
  startedAt: number,
  fastPollIntervalMs: number,
  now = Date.now(),
): number | false {
  const elapsed = now - startedAt;
  if (elapsed >= MAX_POLL_WINDOW_MS) return false;
  return elapsed >= FAST_POLL_WINDOW_MS ? SLOW_POLL_INTERVAL_MS : fastPollIntervalMs;
}

export function useTaskCategoryPolling(
  ids: string[],
  fastPollIntervalMs: number,
  generationKey = '',
) {
  const uniqueIds = [...new Set(ids)];
  const key = `${uniqueIds.join(',')}|${generationKey}`;
  const windowRef = useRef({ key, startedAt: Date.now() });
  if (windowRef.current.key !== key) {
    windowRef.current = { key, startedAt: Date.now() };
  }

  const enabled =
    uniqueIds.length > 0 &&
    (typeof document === 'undefined' || document.body.dataset.taskCategoriesEnabled !== 'false');

  const chunks = Array.from(
    { length: Math.ceil(uniqueIds.length / TASK_CATEGORY_POLL_CHUNK_SIZE) },
    (_, index) =>
      uniqueIds.slice(
        index * TASK_CATEGORY_POLL_CHUNK_SIZE,
        (index + 1) * TASK_CATEGORY_POLL_CHUNK_SIZE,
      ),
  );
  const queries = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['task-category-states', chunk.join(','), generationKey],
      queryFn: async () => {
        const result = await loadTaskCategoryStatesAction({ ids: chunk });
        if (!result.rows) throw new Error(result.error ?? 'Task category polling failed');
        return { rows: result.rows } satisfies TaskCategoryPollResult;
      },
      enabled,
      staleTime: fastPollIntervalMs,
      refetchInterval: (query: Query<TaskCategoryPollResult>) => {
        if (query.state.data?.rows.every((row) => row.taskCategoryStatus !== 'pending')) {
          return false;
        }
        return taskCategoryPollInterval(windowRef.current.startedAt, fastPollIntervalMs);
      },
    })),
  });

  return {
    data: {
      rows: queries.flatMap((query) => query.data?.rows ?? []),
    },
  };
}
