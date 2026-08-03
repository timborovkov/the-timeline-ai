import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function CapturedDocumentsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading captured files
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading captured files"
      >
        <h1 className="sr-only">Captured files</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <PageHeaderSkeleton />
            <Skeleton className="h-9 w-24 rounded-sm" />
          </div>
          <div className="grid gap-3 rounded-md border border-border bg-surface p-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-1">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-9 w-28 rounded-sm" />
                </div>
              ))}
            </div>
            <Skeleton className="h-5 w-16 xl:mt-[1.125rem]" />
          </div>
          <ul
            aria-label="Captured files loading placeholder"
            className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <li key={index} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-sm" />
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-48 max-w-full" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Skeleton className="h-8 w-20 rounded-sm" />
                  <Skeleton className="h-8 w-20 rounded-sm" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
