'use client';

import { useSearchParams } from 'next/navigation';

import {
  CollectionGroupSkeleton,
  CollectionToolbarSkeleton,
  CompactKanbanSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';
import { WorkSubnav } from '@/components/work-subnav';
import { normalizeBoardView } from '@/lib/board-links';

export default function BoardDetailLoading() {
  const searchParams = useSearchParams();
  const view = normalizeBoardView(searchParams.get('view'));

  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading board
      </output>
      <h1 className="sr-only">Board</h1>
      <div
        data-app-layout="full-bleed"
        className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8"
      >
        <div aria-hidden="true" inert className="shrink-0 px-4 pt-5 md:px-8 md:pt-6">
          <PageHeaderSkeleton variant="collection" />
        </div>
        <WorkSubnav current="/app/boards" className="shrink-0 px-4 md:px-8" />
        <div
          aria-hidden="true"
          inert
          aria-busy="true"
          aria-label="Loading board"
          className="flex min-h-0 flex-1 flex-col"
        >
          <CollectionToolbarSkeleton viewSegments={2} action />
          <div data-board-loading-view={view} className="flex min-h-0 flex-1 flex-col">
            {view === 'list' ? <CollectionGroupSkeleton subtitle /> : <CompactKanbanSkeleton />}
          </div>
        </div>
      </div>
    </>
  );
}
