'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { loadTaskCategoryStatesAction } from '@/app/actions/objects';

const SLOW_POLL_INTERVAL_MS = 15_000;
const FAST_POLL_WINDOW_MS = 60_000;

function taskCategoryPollInterval(
  startedAt: number,
  fastPollIntervalMs: number,
  now = Date.now(),
): number {
  return now - startedAt >= FAST_POLL_WINDOW_MS ? SLOW_POLL_INTERVAL_MS : fastPollIntervalMs;
}

export function useTaskCategoryPolling(
  ids: string[],
  fastPollIntervalMs: number,
  generationKey = '',
) {
  const key = `${ids.join(',')}|${generationKey}`;
  const windowRef = useRef({ key, startedAt: Date.now() });
  if (windowRef.current.key !== key) {
    windowRef.current = { key, startedAt: Date.now() };
  }

  const enabled =
    key.length > 0 &&
    (typeof document === 'undefined' || document.body.dataset.taskCategoriesEnabled !== 'false');

  return useQuery({
    queryKey: ['task-category-states', key],
    queryFn: async () => {
      const result = await loadTaskCategoryStatesAction({ ids });
      if (!result.rows) throw new Error(result.error ?? 'Task category polling failed');
      return result;
    },
    enabled,
    initialData: { rows: [] },
    initialDataUpdatedAt: windowRef.current.startedAt,
    staleTime: fastPollIntervalMs,
    refetchInterval: () =>
      taskCategoryPollInterval(windowRef.current.startedAt, fastPollIntervalMs),
  });
}
