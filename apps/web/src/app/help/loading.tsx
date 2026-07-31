import { Skeleton } from '@/components/ui/skeleton';

export default function HelpLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading help
      </output>
      <div className="max-w-3xl space-y-10" aria-busy="true" aria-label="Loading help">
        <header className="space-y-4">
          <h1 className="sr-only">Help</h1>
          <Skeleton className="h-3 w-20 motion-reduce:animate-none" />
          <Skeleton className="h-10 w-full max-w-xl motion-reduce:animate-none" />
          <Skeleton className="h-6 w-full max-w-2xl motion-reduce:animate-none" />
        </header>

        <section aria-label="Help loading placeholder" className="space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-5 w-24 motion-reduce:animate-none" />
            <div className="space-y-3 border-y border-border py-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 py-1">
                  <Skeleton className="size-5 shrink-0 motion-reduce:animate-none" />
                  <Skeleton className="h-5 w-40 motion-reduce:animate-none" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="space-y-3 rounded-sm border border-border p-4">
                <Skeleton className="size-5 motion-reduce:animate-none" />
                <Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-full motion-reduce:animate-none" />
                <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
