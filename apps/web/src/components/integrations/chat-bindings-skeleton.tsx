import { Skeleton } from '@/components/ui/skeleton';

export function ChatBindingsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-3/4 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
