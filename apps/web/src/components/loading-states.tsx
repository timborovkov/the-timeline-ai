import { Skeleton } from '@/components/ui/skeleton';

export function PageHeaderSkeleton() {
  return (
    <header className="mb-10 space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-80" />
    </header>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={`rounded-xl border bg-card p-6 ${className ?? ''}`}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function TimelineFeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ol className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <CardSkeleton />
        </li>
      ))}
    </ol>
  );
}

export function EntityGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

export function InlineSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      {label}
    </div>
  );
}
