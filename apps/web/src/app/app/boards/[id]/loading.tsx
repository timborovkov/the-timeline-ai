import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSubnav } from '@/components/work-subnav';

export default function BoardDetailLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading board
      </output>
      <div
        data-app-layout="full-bleed"
        className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] min-w-0 flex-col md:-mx-8 md:-my-8"
        aria-busy="true"
        aria-label="Loading board"
      >
        <h1 className="sr-only">Board</h1>
        <div className="shrink-0 px-4 pt-5 md:px-8 md:pt-6">
          <PageHeaderSkeleton />
          <WorkSubnav current="/app/boards" className="mt-5" />
        </div>
        <section
          aria-label="Board detail loading placeholder"
          className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-2 pt-5 md:px-8"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex w-[min(290px,calc(100vw-4rem))] shrink-0 flex-col rounded-sm border border-border bg-surface p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
                <Skeleton className="h-3 w-6 motion-reduce:animate-none" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-sm motion-reduce:animate-none" />
                <Skeleton className="h-16 w-full rounded-sm motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
