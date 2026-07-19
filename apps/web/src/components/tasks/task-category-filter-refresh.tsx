'use client';

import { useQuery, type Query } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { WorkFilterState } from '@/lib/work-filters';

import { loadTaskCategoryFilterStateAction } from '@/app/actions/objects';
import { taskCategoryPollInterval } from '@/components/tasks/task-category-polling';

export function TaskCategoryFilterRefresh({
  surface,
  boardId,
  filters,
  baselineToken,
}: {
  surface: 'tasks' | 'objects' | 'board';
  boardId?: string;
  filters: WorkFilterState;
  baselineToken: string;
}) {
  const router = useRouter();
  const [mountedAt] = useState(Date.now);
  const { data } = useQuery({
    queryKey: ['task-category-filter-state', surface, boardId ?? '', filters, baselineToken],
    queryFn: async () => {
      const result = await loadTaskCategoryFilterStateAction({
        surface,
        ...(boardId ? { boardId } : {}),
        filters,
        baselineToken,
      });
      if (!result.state) throw new Error(result.error ?? 'Category filter refresh failed');
      return result.state;
    },
    refetchInterval: (state: Query<{ token: string; changed: boolean; pending: boolean }>) => {
      if (state.state.data?.changed || state.state.data?.pending === false) return false;
      return taskCategoryPollInterval(mountedAt, 2_500);
    },
  });
  const refreshedToken = useRef<string | null>(null);
  useEffect(() => {
    if (!data?.changed || refreshedToken.current === data.token) return;
    refreshedToken.current = data.token;
    router.refresh();
  }, [data, router]);
  return null;
}
