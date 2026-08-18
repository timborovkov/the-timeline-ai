import { HairlineSectionSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function DocumentDetailLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading document
      </output>
      <div className="space-y-6" aria-busy="true" aria-label="Loading document">
        <h1 className="sr-only">Document</h1>
        <div className="flex justify-end">
          <Skeleton className="h-8 w-20 rounded-sm" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-4 w-16" />
          <HairlineSectionSkeleton lines={2} />
          <section className="space-y-3 border-y border-border py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-8 w-24 rounded-sm" />
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <Skeleton className="min-h-72 w-full rounded-sm" />
              <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-sm" />
                <Skeleton className="h-20 w-full rounded-sm" />
                <Skeleton className="h-16 w-full rounded-sm" />
              </div>
            </div>
          </section>
          <section className="space-y-3 border-y border-border py-4">
            <Skeleton className="h-5 w-28" />
            <ul className="divide-y divide-border border-y border-border">
              {Array.from({ length: 3 }).map((_, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between gap-3 py-3 max-sm:flex-col max-sm:items-stretch"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-20 rounded-sm" />
                    <Skeleton className="h-8 w-24 rounded-sm" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
