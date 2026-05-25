import { Skeleton } from '@/components/ui/skeleton';

export default function BoardDetailLoading() {
  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col">
      <header className="mb-8 flex shrink-0 items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-9 rounded-md" />
      </header>

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto">
        {Array.from({ length: 3 }).map((_, col) => (
          <div
            key={col}
            className="flex w-72 shrink-0 flex-col rounded-lg border bg-card/40 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-6" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-md border bg-card p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
