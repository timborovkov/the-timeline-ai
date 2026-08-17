import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading Ask
      </output>
      <div
        data-app-layout="full-bleed"
        className="-mx-4 -my-6 flex h-[calc(100dvh-3rem)] motion-reduce:[&_.animate-pulse]:animate-none md:-mx-8 md:-my-8"
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
          <section className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-5 md:px-8 md:py-6">
            <div className="mb-3 rounded-sm border border-border p-2 md:hidden">
              <div className="flex min-h-9 items-center gap-3 px-1">
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <header className="mb-5 flex shrink-0 items-baseline gap-x-3 border-b border-border pb-3">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-4 w-48" />
            </header>
            <div className="min-h-0 flex-1" />
            <Skeleton className="h-12 w-full shrink-0 rounded-sm" />
          </section>
        </div>
      </div>
    </>
  );
}
