import { Skeleton } from '@/components/ui/skeleton';
import { HELP_PAGES } from '@/lib/help-content';

export default function HelpLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading help
      </output>
      <article
        className="space-y-12 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading help"
      >
        <h1 className="sr-only">Help</h1>
        <div aria-hidden="true" inert className="space-y-12">
          <header className="max-w-[70ch] space-y-4">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-10 w-full max-w-xl sm:h-11" />
            <Skeleton className="h-6 w-full max-w-[62ch]" />
            <Skeleton className="h-6 w-4/5 max-w-[50ch]" />
          </header>

          <section className="border-t border-border pt-8">
            <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="space-y-1">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-4 w-full max-w-[62ch]" />
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="mt-6 border-y border-border">
              {HELP_PAGES.map((page) => (
                <div
                  key={page.slug}
                  className="grid gap-3 border-b border-border px-1 py-5 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-3"
                >
                  <Skeleton className="h-3 w-6" />
                  <div className="min-w-0 space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-full max-w-[62ch]" />
                  </div>
                  <Skeleton className="hidden size-9 sm:block" />
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 border-y border-border py-7 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="space-y-2">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-full max-w-[62ch]" />
            </div>
            <Skeleton className="h-10 w-40" />
          </section>

          <section className="border-y border-border py-7">
            <div className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full max-w-[62ch]" />
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-5 w-24" />
              ))}
            </div>
          </section>
        </div>
      </article>
    </>
  );
}
