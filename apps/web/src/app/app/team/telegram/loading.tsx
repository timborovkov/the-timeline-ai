import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function TelegramLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-busy="true">
      <PageHeaderSkeleton />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-2.5 rounded-sm border border-border bg-surface p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
