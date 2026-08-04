import { Skeleton } from '@/components/ui/skeleton';

export default function HelpLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading help
      </output>
      <div
        className="max-w-3xl space-y-10 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading help"
      >
        <h1 className="sr-only">Help</h1>
        <div aria-hidden="true" inert className="space-y-10">
          <header className="space-y-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full max-w-xl" />
            <Skeleton className="h-6 w-full max-w-2xl" />
          </header>

          <section className="space-y-8">
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <div className="space-y-3 border-y border-border py-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 py-1">
                    <Skeleton className="size-5 shrink-0" />
                    <Skeleton className="h-5 w-40" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-3 rounded-sm border border-border p-4">
                  <Skeleton className="size-5" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
