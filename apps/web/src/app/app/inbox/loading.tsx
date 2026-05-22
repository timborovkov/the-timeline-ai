import { PageHeaderSkeleton } from '@/components/loading-states';
import { Skeleton } from '@/components/ui/skeleton';

export default function InboxLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <ul className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="rounded-lg border bg-card px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </li>
        ))}
      </ul>
    </div>
  );
}
