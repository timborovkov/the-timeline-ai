'use client';

import { useSearchParams } from 'next/navigation';

import {
  CollectionGroupSkeleton,
  CollectionToolbarSkeleton,
  CompactKanbanSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';

export default function TasksLoading() {
  const searchParams = useSearchParams();
  const isKanban = searchParams.get('view') === 'kanban';

  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading tasks
      </output>
      <div
        data-app-layout="full-bleed"
        className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8"
        aria-busy="true"
        aria-label="Loading tasks"
      >
        <h1 className="sr-only">Tasks</h1>
        <div aria-hidden="true" inert className="shrink-0 px-4 pt-5 md:px-8">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/tasks" className="shrink-0 px-4 md:px-8" />
        <div aria-hidden="true" inert className="shrink-0">
          <CollectionToolbarSkeleton viewSegments={2} />
        </div>
        <div
          aria-hidden="true"
          inert
          data-tasks-loading-view={isKanban ? 'kanban' : 'list'}
          className="flex min-h-0 flex-1 flex-col"
        >
          {isKanban ? (
            <CompactKanbanSkeleton columns={5} variant="task" />
          ) : (
            <CollectionGroupSkeleton />
          )}
        </div>
      </div>
    </>
  );
}
