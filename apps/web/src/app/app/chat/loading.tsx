import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Ask
      </output>
      <div
        data-app-layout="full-bleed"
        className="flex h-full motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading Ask"
      >
        <h1 className="sr-only">Ask</h1>
        <div aria-hidden="true" inert className="flex min-h-0 min-w-0 flex-1">
          <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-surface p-3 md:flex">
            <Skeleton className="mb-2 h-9 w-full rounded-sm" />
            <Skeleton className="mb-3 h-9 w-full rounded-sm" />
            <ul className="flex-1 space-y-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="h-7 w-full rounded-sm" />
                </li>
              ))}
            </ul>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex min-h-12 shrink-0 items-center gap-x-3 border-b border-border px-4 py-2.5 md:px-8">
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-4 w-48" />
            </header>
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-5 pt-4 md:px-8 md:pb-6">
              <div className="mb-3 rounded-sm border border-border md:hidden">
                <div className="flex min-h-9 items-center gap-3 px-3">
                  <Skeleton className="h-4 w-40" />
                </div>
              </div>
              <div className="min-h-0 flex-1" />
              <Skeleton className="h-10 w-full shrink-0 rounded-sm" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
