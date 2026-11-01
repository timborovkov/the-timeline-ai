import { Skeleton } from '@/components/ui/skeleton';

export function MergeObjectRowsSkeleton() {
  return (
    <div className="grid gap-px overflow-hidden border border-border">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="bg-bg px-3 py-2.5">
          <div className="flex min-h-7 items-center gap-3">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-3 w-8" />
          </div>
          <div className="mt-2 border-t border-border/70 pt-2">
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}
