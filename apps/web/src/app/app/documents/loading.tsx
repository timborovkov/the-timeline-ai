import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentsLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading documents
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading documents"
      >
        <h1 className="sr-only">Documents</h1>
        <div className="space-y-6" aria-hidden="true" inert>
          <PageHeaderSkeleton />
          <section className="space-y-3">
            <Skeleton className="h-10 w-full rounded-sm" />
          </section>
          <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-4 w-32 max-w-full" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-20 rounded-sm" />
              <Skeleton className="h-8 w-24 rounded-sm" />
              <Skeleton className="h-8 w-20 rounded-sm" />
            </div>
          </section>
          <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-8 w-24 rounded-sm" />
          </section>
          <section className="space-y-6 rounded-lg border border-border bg-card/30 p-6">
            <section>
              <h2 className="sr-only">Folders</h2>
              <Skeleton className="mb-3 h-5 w-16" />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <li key={index} className="rounded-lg border border-border bg-card p-3">
                    <Skeleton className="h-4 w-32 max-w-full" />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="sr-only">Documents</h2>
              <Skeleton className="mb-3 h-5 w-24" />
              <ul className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li
                    key={index}
                    className="grid gap-3 rounded-lg border border-border bg-card px-3 py-2.5 lg:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-56 max-w-full" />
                      <Skeleton className="h-3 w-40 max-w-full" />
                      <Skeleton className="h-3 w-full max-w-lg" />
                    </div>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <Skeleton className="h-6 w-16 rounded-sm" />
                      <Skeleton className="h-8 w-8 rounded-sm" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </section>
        </div>
      </div>
    </>
  );
}
