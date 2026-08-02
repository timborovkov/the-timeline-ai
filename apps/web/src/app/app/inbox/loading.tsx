import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function InboxLoading() {
  return (
    <>
      <output className="sr-only" aria-live="polite">
        Loading inbox
      </output>
      <div
        className="space-y-6 motion-reduce:[&_.animate-pulse]:animate-none"
        aria-busy="true"
        aria-label="Loading inbox"
      >
        <h1 className="sr-only">Inbox</h1>
        <div aria-hidden="true" inert className="space-y-6">
          <PageHeaderSkeleton />
          <section className="space-y-6">
            <nav className="flex gap-1.5">
              <Skeleton className="h-9 w-12 rounded-sm" />
              <Skeleton className="h-9 w-16 rounded-sm" />
            </nav>
            <ul className="border-t border-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-border py-3 sm:grid-cols-[18ch_1fr] sm:gap-y-1"
                >
                  <Skeleton className="h-3 w-[16ch]" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-2/3" />
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
