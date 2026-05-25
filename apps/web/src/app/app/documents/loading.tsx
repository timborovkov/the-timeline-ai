import { NarrowContainer } from '@/components/narrow-container';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Matches the DocumentDrive layout: breadcrumb nav, header with New
 * folder + Upload buttons, and a dashed-border drop zone containing
 * folder cards + a document list. Mirrors the shape PR #20 established
 * for every other route so navigation never flashes a blank screen.
 */
export default function DocumentsLoading() {
  return (
    <NarrowContainer>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </header>

        <div className="rounded-xl border border-dashed border-border bg-card/30 p-6">
          <div className="space-y-6">
            <section>
              <Skeleton className="mb-3 h-3 w-16" />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-32" />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <Skeleton className="mb-3 h-3 w-20" />
              <ul className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
                  >
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-16" />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </NarrowContainer>
  );
}
