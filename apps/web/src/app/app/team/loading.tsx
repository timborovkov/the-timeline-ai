import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TeamLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading team settings
      </output>
      <h1 className="sr-only">Team</h1>
      <div className="space-y-4" aria-busy="true" aria-label="Loading team settings">
        <div aria-hidden="true" className="space-y-4">
          <PageHeaderSkeleton variant="collection" />
          <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
            <aside className="min-w-0 lg:self-start">
              <div className="w-full max-w-full overflow-x-auto border-b border-border lg:w-52 lg:overflow-visible lg:border-r lg:border-b-0 lg:pr-4">
                <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-9 w-20 shrink-0 motion-reduce:animate-none lg:w-full"
                    />
                  ))}
                </div>
              </div>
            </aside>
            <div className="min-w-0 flex-1 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0"
                >
                  <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
                  <Skeleton className="h-9 w-full motion-reduce:animate-none" />
                  <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
